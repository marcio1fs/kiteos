/**
 * Importação de NF-e pela chave de acesso — o núcleo real, sem HTTP.
 *
 * FISC-04: a fila assíncrona marcava `COMPLETED` com uma mensagem de sucesso sem
 * consultar a SEFAZ, sem baixar XML e sem gravar nota. O usuário acreditava que a
 * NF-e tinha sido importada. Este módulo existe para que a rota síncrona e o job
 * assíncrono chamem **o mesmo** código: ninguém mais consegue declarar conclusão
 * sem uma nota persistida.
 *
 * Sequência real: certificado ativo da oficina → `consultaProtocolo` (registra a
 * consulta em `sefazConsultas` aconteça o que acontecer) → bloqueio se não
 * AUTORIZADA → `downloadNfe` → validação e parse do XML → fornecedor →
 * `invoice` + itens → recepção PENDENTE → auditoria.
 */

import { db } from '@/lib/db';
import { createAuditLog } from '@/lib/audit';
import {
  consultaProtocolo,
  downloadNfe,
  getUfFromChave,
  mapSefazErrorToFriendly,
  decryptFileContent,
  decryptPassword,
  type SefazClientConfig,
  type Ambiente,
} from '@/lib/sefaz';
import { parseNFeXml, validateXmlStructure } from '@/lib/nfe/xml-parser';

/** Status que impedem a importação: o documento não é aproveitável. */
const BLOCKED_STATUSES = ['CANCELADA', 'DENEGADA', 'INUTILIZADA'];

export type ImportNfeSuccess = {
  ok: true;
  invoiceId: string;
  chave: string;
  numero: string;
  fornecedor: string;
  valorTotal: number;
  sefazConsultaId: string;
};

export type ImportNfeFailure = {
  ok: false;
  /** HTTP que a rota deve devolver; o job usa apenas `code`/`error`. */
  status: number;
  code:
    | 'ALREADY_IMPORTED'
    | 'CERTIFICADO_AUSENTE'
    | 'UF_INDETERMINADA'
    | 'NFE_NAO_AUTORIZADA'
    | 'XML_INDISPONIVEL'
    | 'XML_INVALIDO'
    | 'XML_PARSE_ERROR';
  error: string;
  data?: Record<string, unknown>;
};

export type ImportNfeResult = ImportNfeSuccess | ImportNfeFailure;

export async function importNfeByChave(input: {
  chave: string;
  officeId: string;
  userId: string;
}): Promise<ImportNfeResult> {
  const { chave, officeId, userId } = input;

  const existingInvoice = await db.invoice.findFirst({
    where: { chave, deleted: false, officeId },
  });
  if (existingInvoice) {
    return { ok: false, status: 409, code: 'ALREADY_IMPORTED', error: 'NF-e já importada neste escritório' };
  }

  const certificado = await db.certificadoDigital.findFirst({
    where: { officeId, ativo: true, deleted: false },
  });
  if (!certificado) {
    // Sem certificado não há mTLS: nada pode ser consultado, muito menos importado.
    return {
      ok: false,
      status: 404,
      code: 'CERTIFICADO_AUSENTE',
      error: 'Nenhum certificado digital ativo encontrado para este escritório',
    };
  }

  const uf = getUfFromChave(chave) || certificado.uf;
  if (!uf) {
    return {
      ok: false,
      status: 400,
      code: 'UF_INDETERMINADA',
      error: 'Não foi possível determinar a UF a partir da chave de acesso ou do certificado',
    };
  }

  let pfx: string | undefined;
  let passphrase: string | undefined;
  try {
    if (certificado.arquivoContent && certificado.senhaCriptografada) {
      pfx = decryptFileContent(certificado.arquivoContent);
      passphrase = decryptPassword(certificado.senhaCriptografada);
    }
  } catch (certDecError) {
    console.error('Erro ao descriptografar certificado:', certDecError);
  }

  const cnpjCpf = certificado.cnpjCpf || '';
  const config: SefazClientConfig = {
    ambiente: certificado.ambiente as Ambiente,
    uf,
    cnpjCpf,
    pfx,
    passphrase,
  };

  const consultaResult = await consultaProtocolo(chave, config);
  const nfeStatus = consultaResult.data?.nfeStatus || 'ERRO';
  const codigoStatus = consultaResult.data?.cStat || null;
  const motivoStatus = consultaResult.data?.xMotivo || null;

  // A consulta fica registrada independentemente do resultado: é a evidência
  // durável do que a SEFAZ respondeu (o job em memória não sobrevive a restart).
  const sefazConsulta = await db.sefazConsulta.create({
    data: {
      chave,
      ambiente: certificado.ambiente,
      protocolo: consultaResult.data?.protocolo || null,
      status: nfeStatus,
      fornecedorCnpj: consultaResult.data?.fornecedorCnpj || null,
      xmlArmazenado: false,
      codigoStatus,
      motivoStatus,
      tempoResposta: consultaResult.tempoResposta || null,
      tentativas: consultaResult.tentativas,
      erroMensagem: !consultaResult.success ? consultaResult.error || null : null,
      erroAmigavel: !consultaResult.success
        ? consultaResult.friendlyError || mapSefazErrorToFriendly(codigoStatus || '', motivoStatus || '')
        : null,
      officeId,
      usuarioId: userId,
    },
  });

  if (!consultaResult.success || BLOCKED_STATUSES.includes(nfeStatus)) {
    const friendlyMsg = nfeStatus === 'CANCELADA'
      ? 'NF-e está cancelada e não pode ser importada'
      : nfeStatus === 'DENEGADA'
        ? 'NF-e está denegada e não pode ser importada'
        : nfeStatus === 'INUTILIZADA'
          ? 'NF-e está inutilizada e não pode ser importada'
          : consultaResult.friendlyError || mapSefazErrorToFriendly(codigoStatus || '', motivoStatus || '');

    return {
      ok: false,
      status: 422,
      code: 'NFE_NAO_AUTORIZADA',
      error: friendlyMsg,
      data: { status: nfeStatus, cStat: codigoStatus, xMotivo: motivoStatus },
    };
  }

  const downloadResult = await downloadNfe(chave, config);
  if (!downloadResult.success || !downloadResult.data?.xmlContent) {
    return {
      ok: false,
      status: 422,
      code: 'XML_INDISPONIVEL',
      error: 'NF-e autorizada, mas não foi possível baixar o XML. Tente novamente.',
      data: { status: nfeStatus, cStat: codigoStatus },
    };
  }

  const xmlContent = downloadResult.data.xmlContent;

  await db.sefazConsulta.update({
    where: { id: sefazConsulta.id },
    data: { xmlArmazenado: true, xmlContent },
  });

  const xmlValidation = validateXmlStructure(xmlContent);
  if (!xmlValidation.valid) {
    return {
      ok: false,
      status: 400,
      code: 'XML_INVALIDO',
      error: `XML inválido: ${xmlValidation.errors.join(', ')}`,
    };
  }

  let parsedNFe;
  try {
    parsedNFe = parseNFeXml(xmlContent);
  } catch (parseError) {
    const message = parseError instanceof Error ? parseError.message : 'Erro ao parsear XML';
    return { ok: false, status: 400, code: 'XML_PARSE_ERROR', error: `Erro no parse do XML: ${message}` };
  }

  let supplier = await db.supplier.findFirst({
    where: { cnpj: parsedNFe.supplierCnpj, officeId, deleted: false },
  });

  if (!supplier) {
    supplier = await db.supplier.create({
      data: {
        cnpj: parsedNFe.supplierCnpj,
        razaoSocial: parsedNFe.supplierRazaoSocial,
        nomeFantasia: parsedNFe.emitente.nomeFantasia,
        ie: parsedNFe.emitente.ie,
        address: parsedNFe.emitente.endereco.logradouro
          ? `${parsedNFe.emitente.endereco.logradouro}, ${parsedNFe.emitente.endereco.numero || 'S/N'}`
          : null,
        city: parsedNFe.emitente.endereco.municipio,
        state: parsedNFe.emitente.endereco.uf,
        zipCode: parsedNFe.emitente.endereco.cep,
        phone: parsedNFe.emitente.endereco.fone,
        officeId,
      },
    });
  } else {
    await db.supplier.update({
      where: { id: supplier.id },
      data: {
        razaoSocial: parsedNFe.supplierRazaoSocial,
        ...(parsedNFe.emitente.nomeFantasia ? { nomeFantasia: parsedNFe.emitente.nomeFantasia } : {}),
        ...(parsedNFe.emitente.ie ? { ie: parsedNFe.emitente.ie } : {}),
        ...(parsedNFe.emitente.endereco.municipio ? { city: parsedNFe.emitente.endereco.municipio } : {}),
        ...(parsedNFe.emitente.endereco.uf ? { state: parsedNFe.emitente.endereco.uf } : {}),
        ...(parsedNFe.emitente.endereco.cep ? { zipCode: parsedNFe.emitente.endereco.cep } : {}),
        ...(parsedNFe.emitente.endereco.fone ? { phone: parsedNFe.emitente.endereco.fone } : {}),
      },
    });
  }

  const subtotal = parsedNFe.items.reduce((sum, item) => sum + item.vProd, 0);
  const dataEmissao = parsedNFe.dataEmissao ? new Date(parsedNFe.dataEmissao) : new Date();

  const invoice = await db.invoice.create({
    data: {
      chave: parsedNFe.chave,
      numero: parsedNFe.numero,
      serie: parsedNFe.serie,
      tipoOperacao: 'ENTRADA',
      dataEmissao,
      dataEntrada: new Date(),
      subtotal,
      frete: parsedNFe.totals.vFrete,
      seguro: parsedNFe.totals.vSeg,
      desconto: parsedNFe.totals.vDesc,
      baseIcms: parsedNFe.totals.vBC,
      valorIcms: parsedNFe.totals.vICMS,
      valorIpi: parsedNFe.totals.vIPI,
      valorPis: parsedNFe.totals.vPIS,
      valorCofins: parsedNFe.totals.vCOFINS,
      totalNf: parsedNFe.totals.vNF,
      xmlContent,
      status: 'IMPORTADA',
      observacao: [
        parsedNFe.infCpl,
        parsedNFe.naturezaOperacao ? `Nat. Op.: ${parsedNFe.naturezaOperacao}` : null,
        parsedNFe.transporte?.transportadoraNome ? `Transp.: ${parsedNFe.transporte.transportadoraNome}` : null,
        parsedNFe.transporte?.veiculoPlaca ? `Veículo: ${parsedNFe.transporte.veiculoPlaca}/${parsedNFe.transporte.veiculoUf}` : null,
        parsedNFe.formaPagamento ? `Forma Pagto: ${parsedNFe.formaPagamento}` : null,
        parsedNFe.duplicatas.length > 0 ? `Parcelas: ${parsedNFe.duplicatas.length}` : null,
      ].filter(Boolean).join(' | ') || null,
      supplierId: supplier.id,
      officeId,
      items: {
        create: parsedNFe.items.map((item) => ({
          sku: item.cProd || null,
          descricao: item.xProd,
          ncm: item.ncm,
          cfop: item.cfop,
          cst: item.cst || null,
          csosn: item.csosn || null,
          quantidade: item.qCom,
          unidade: item.uCom,
          valorUnitario: item.vUnCom,
          valorTotal: item.vProd,
          baseIcms: item.vBC_Icms,
          valorIcms: item.vICMS,
          valorIpi: item.vIPI,
          valorPis: item.vPIS,
          valorCofins: item.vCOFINS,
          officeId,
        })),
      },
    },
    include: {
      items: true,
      supplier: true,
    },
  });

  await db.reception.create({
    data: { status: 'PENDENTE', invoiceId: invoice.id, officeId },
  });

  await db.sefazConsulta.update({
    where: { id: sefazConsulta.id },
    data: { invoiceId: invoice.id },
  });

  await createAuditLog({
    action: 'SEFAZ_IMPORTAR',
    entity: 'Invoice',
    entityId: invoice.id,
    details: JSON.stringify({
      method: 'SEFAZ_IMPORT',
      chave: parsedNFe.chave,
      numero: parsedNFe.numero,
      supplierCnpj: parsedNFe.supplierCnpj,
      totalNf: parsedNFe.totals.vNF,
      itemCount: parsedNFe.items.length,
      sefazConsultaId: sefazConsulta.id,
    }),
    userId,
    officeId,
    invoiceId: invoice.id,
  });

  return {
    ok: true,
    invoiceId: invoice.id,
    chave: parsedNFe.chave,
    numero: parsedNFe.numero,
    fornecedor: supplier.razaoSocial,
    valorTotal: parsedNFe.totals.vNF,
    sefazConsultaId: sefazConsulta.id,
  };
}
