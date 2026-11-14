/**
 * Estados de documento fiscal — e a única porta que permite chegar a "emitido".
 *
 * FISC-01/FISC-02: NFS-e e notas de cliente eram gravadas como `EMITIDA` (e
 * `CANCELADA`) sem nenhuma transmissão ao município ou à SEFAZ. O documento
 * fiscal era fictício: existia no banco com cara de autorizado, sem protocolo,
 * sem código de verificação e sem resposta de órgão nenhum.
 *
 * O status passa a seguir o ciclo de vida real do documento:
 *
 *   RPS / RASCUNHO -> criado localmente. NÃO é documento fiscal.
 *   EMITIDA        -> autorizado pelo órgão fiscal. Exige prova.
 *   CANCELADA      -> cancelamento autorizado pelo órgão. Exige prova
 *                     (exceto para o que nunca foi transmitido).
 *
 * `issuedNfseData()` e `issuedInvoiceData()` são os únicos produtores da string
 * `'EMITIDA'` neste módulo: recebem uma `AuthorizationProof` e recusam devolver
 * dados sem protocolo. Assim nenhum caminho de código consegue marcar um
 * documento como emitido por acidente — a prova é pré-requisito estrutural.
 */

/** Resposta do órgão fiscal (ou do provedor que fala com ele) autorizando o documento. */
export type AuthorizationProof = {
  /** Protocolo de autorização da SEFAZ, ou número/protocolo da NFS-e no município. */
  protocol: string;
  /** Código de verificação emitido pelo município (NFS-e). Nunca gerado localmente. */
  verificationCode?: string | null;
  /** Ambiente em que a autorização ocorreu. */
  environment: 'HOMOLOGACAO' | 'PRODUCAO';
  authorizedAt: Date;
  /** Resposta bruta, para auditoria/reprocessamento. */
  raw?: string | null;
};

/** NFS-e criada localmente: recibo provisório, ainda não é documento fiscal. */
export const NFSE_RPS_STATUS = 'RPS';
/** NFS-e autorizada pelo município. */
export const NFSE_ISSUED_STATUS = 'EMITIDA';
export const NFSE_CANCELLED_STATUS = 'CANCELADA';

/** NF-e de venda (ClientInvoice) criada localmente, antes da SEFAZ. */
export const INVOICE_DRAFT_STATUS = 'RASCUNHO';
export const INVOICE_ISSUED_STATUS = 'EMITIDA';
export const INVOICE_CANCELLED_STATUS = 'CANCELADA';

export class FiscalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'FiscalError';
  }
}

/** Erro para "não existe integração com o órgão fiscal configurada". */
export function notIntegratedError(document: string): FiscalError {
  return new FiscalError(
    `${document}: nenhuma integração com o órgão fiscal está configurada. O documento permanece como rascunho e não tem validade fiscal.`,
    501,
    'PROVIDER_NOT_INTEGRATED',
  );
}

/**
 * A prova de autorização é obrigatória e precisa identificar a autorização.
 * Protocolo vazio, ausente ou placeholder é recusado: sem ele não há como
 * conferir o documento no órgão fiscal, que é o que separa um documento real de
 * um registro interno.
 */
export function assertAuthorized(
  proof: AuthorizationProof | null | undefined,
  document: string,
): AuthorizationProof {
  const protocol = typeof proof?.protocol === 'string' ? proof.protocol.trim() : '';
  if (!proof || protocol.length === 0) {
    throw new FiscalError(
      `${document} não foi autorizado pelo órgão fiscal — não pode ser marcado como emitido`,
      409,
      'NOT_AUTHORIZED',
    );
  }
  return { ...proof, protocol };
}

/** Dados que levam uma NFS-e de RPS a EMITIDA. Só existem mediante prova. */
export function issuedNfseData(proof: AuthorizationProof | null | undefined) {
  const authorized = assertAuthorized(proof, 'NFS-e');
  return {
    status: NFSE_ISSUED_STATUS,
    // O código de verificação é do município. Enquanto ele não vier na resposta,
    // fica nulo — inventar um código localmente seria fabricar documento.
    codigoVerificacao: authorized.verificationCode?.trim() || null,
    dataEmissao: authorized.authorizedAt,
  };
}

/** Dados que levam uma NF-e de venda de RASCUNHO a EMITIDA. Só existem mediante prova. */
export function issuedInvoiceData(
  proof: AuthorizationProof | null | undefined,
  chave: string | null | undefined,
) {
  const authorized = assertAuthorized(proof, 'NF-e');
  const accessKey = typeof chave === 'string' ? chave.trim() : '';
  if (accessKey.length !== 44) {
    throw new FiscalError(
      'NF-e autorizada sem chave de acesso de 44 dígitos — recuse a resposta e não marque como emitida',
      409,
      'INVALID_ACCESS_KEY',
    );
  }
  return {
    status: INVOICE_ISSUED_STATUS,
    protocoloAutorizacao: authorized.protocol,
    chave: accessKey,
    dataEmissao: authorized.authorizedAt,
  };
}

/**
 * Cancelamento: o que nunca foi transmitido pode ser descartado localmente; o
 * que foi autorizado só sai mediante prova de cancelamento do órgão.
 */
/**
 * O schema não tem coluna de protocolo de cancelamento, então `data` carrega só o
 * que existe e `proof` sai à parte para a trilha de auditoria. Inventar coluna sem
 * migration quebraria o gate de drift do CI.
 */
export function cancelledInvoiceData(
  currentStatus: string,
  proof: AuthorizationProof | null | undefined,
  motivo: string,
): {
  data: { status: string; dataCancelamento: Date; motivoCancelamento: string };
  proof: AuthorizationProof | null;
  transmitted: boolean;
} {
  const reason = motivo.trim();
  if (reason.length === 0) {
    throw new FiscalError('Informe o motivo do cancelamento', 400, 'MISSING_REASON');
  }
  // Nunca transmitido: não existe autorização a desfazer no órgão, o descarte é local.
  if (currentStatus === INVOICE_DRAFT_STATUS || currentStatus === NFSE_RPS_STATUS) {
    return {
      data: {
        status: INVOICE_CANCELLED_STATUS,
        dataCancelamento: new Date(),
        motivoCancelamento: reason,
      },
      proof: null,
      transmitted: false,
    };
  }
  const authorized = assertAuthorized(proof, 'Cancelamento');
  return {
    data: {
      status: INVOICE_CANCELLED_STATUS,
      dataCancelamento: authorized.authorizedAt,
      motivoCancelamento: reason,
    },
    proof: authorized,
    transmitted: true,
  };
}

/** Resposta de erro fiscal padronizada para as rotas. */
export function fiscalErrorResponse(error: unknown): { body: Record<string, unknown>; status: number } | null {
  if (error instanceof FiscalError) {
    return {
      body: { success: false, error: error.message, code: error.code },
      status: error.status,
    };
  }
  return null;
}
