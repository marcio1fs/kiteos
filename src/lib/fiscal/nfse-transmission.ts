/**
 * Transmissão de NFS-e: RPS -> EMITIDA, e cancelamento autorizado.
 *
 * A regra que importa é estrutural: o status `EMITIDA` só é escrito por
 * `issuedNfseData()`, que exige uma `AuthorizationProof` com protocolo. Se não há
 * provedor configurado, a função lança `501 PROVIDER_NOT_INTEGRATED` e o
 * documento permanece RPS — ou seja, o sistema nunca mais afirma ter emitido algo
 * que não transmitiu (FISC-01).
 *
 * Concorrência segue o padrão dos outros módulos: a transição é a trava
 * (`updateMany` com `status: 'RPS'` no WHERE), então duas transmissões simultâneas
 * não podem ambas marcar como emitida. Retries caem no caminho idempotente.
 */

import { db } from '@/lib/db';
import { auditLog } from '@/lib/auth';
import { CommercialError } from '@/lib/commercial';
import {
  FiscalError,
  NFSE_CANCELLED_STATUS,
  NFSE_ISSUED_STATUS,
  NFSE_RPS_STATUS,
  assertAuthorized,
  issuedNfseData,
  notIntegratedError,
} from './document-status';
import { resolveNfseProvider, type NfseProvider } from './provider';

export type NfseTransmitActor = { userId: string; officeId: string };

export async function transmitNfse(
  nfseId: string,
  actor: NfseTransmitActor,
  opts: { provider?: NfseProvider | null } = {},
) {
  const nfse = await db.nfseServico.findFirst({
    where: { id: nfseId, officeId: actor.officeId, deleted: false },
  });
  if (!nfse) throw new CommercialError('NFS-e não encontrada', 404);

  // Idempotência: já autorizada devolve o que existe, sem transmitir de novo.
  if (nfse.status === NFSE_ISSUED_STATUS) {
    return { nfse, alreadyTransmitted: true };
  }
  if (nfse.status === NFSE_CANCELLED_STATUS) {
    throw new FiscalError('NFS-e cancelada não pode ser transmitida', 409, 'ALREADY_CANCELLED');
  }
  if (nfse.status !== NFSE_RPS_STATUS) {
    throw new FiscalError(
      `Somente RPS pode ser transmitido (status atual: ${nfse.status})`,
      409,
      'INVALID_STATE',
    );
  }

  const provider = opts.provider !== undefined ? opts.provider : await resolveNfseProvider(actor.officeId);
  if (!provider) throw notIntegratedError('NFS-e');

  const proof = assertAuthorized(
    await provider.transmit({
      nfseId: nfse.id,
      officeId: actor.officeId,
      xml: nfse.xmlContent ?? '',
      numero: nfse.numero,
      competencia: nfse.competencia,
    }),
    'NFS-e',
  );

  const issued = issuedNfseData(proof);

  // CAS: só quem ainda vê RPS transmite. Perdedor sai sem escrever nada.
  const claimed = await db.nfseServico.updateMany({
    where: { id: nfse.id, officeId: actor.officeId, status: NFSE_RPS_STATUS, deleted: false },
    data: issued,
  });
  if (claimed.count !== 1) {
    throw new FiscalError(
      'NFS-e transmitida por outra operação. Recarregue e tente novamente.',
      409,
      'CONCURRENT_TRANSMISSION',
    );
  }

  await auditLog({
    action: 'NFSE_TRANSMITTED',
    entity: 'NfseServico',
    entityId: nfse.id,
    details: JSON.stringify({
      numero: nfse.numero,
      provider: provider.name,
      protocol: proof.protocol,
      codigoVerificacao: issued.codigoVerificacao,
      environment: proof.environment,
      authorizedAt: proof.authorizedAt.toISOString(),
    }),
    userId: actor.userId,
    officeId: actor.officeId,
  });

  const updated = await db.nfseServico.findFirst({ where: { id: nfse.id, officeId: actor.officeId } });
  return { nfse: updated ?? { ...nfse, ...issued }, alreadyTransmitted: false };
}

/**
 * Cancelamento: RPS nunca transmitido é descartado localmente; NFS-e autorizada
 * só cancela com prova do município.
 */
export async function cancelNfse(
  nfseId: string,
  actor: NfseTransmitActor,
  motivo: string,
  opts: { provider?: NfseProvider | null } = {},
) {
  const reason = (motivo ?? '').trim();
  if (reason.length < 3) {
    throw new FiscalError('Informe o motivo do cancelamento', 400, 'MISSING_REASON');
  }

  const nfse = await db.nfseServico.findFirst({
    where: { id: nfseId, officeId: actor.officeId, deleted: false },
  });
  if (!nfse) throw new CommercialError('NFS-e não encontrada', 404);
  if (nfse.status === NFSE_CANCELLED_STATUS) {
    return { nfse, alreadyCancelled: true };
  }

  // RPS: nunca houve autorização, então o descarte é local e legítimo.
  if (nfse.status === NFSE_RPS_STATUS) {
    const claimed = await db.nfseServico.updateMany({
      where: { id: nfse.id, officeId: actor.officeId, status: NFSE_RPS_STATUS, deleted: false },
      data: { status: NFSE_CANCELLED_STATUS, motivoCancelamento: reason },
    });
    if (claimed.count !== 1) {
      throw new FiscalError('NFS-e alterada por outra operação. Recarregue.', 409, 'CONCURRENT_CHANGE');
    }
    await auditLog({
      action: 'NFSE_RPS_DISCARDED',
      entity: 'NfseServico',
      entityId: nfse.id,
      details: JSON.stringify({ numero: nfse.numero, reason, transmitted: false }),
      userId: actor.userId,
      officeId: actor.officeId,
    });
    const updated = await db.nfseServico.findFirst({ where: { id: nfse.id, officeId: actor.officeId } });
    return { nfse: updated ?? nfse, alreadyCancelled: false };
  }

  // EMITIDA: precisa do cancelamento autorizado pelo município.
  const provider = opts.provider !== undefined ? opts.provider : await resolveNfseProvider(actor.officeId);
  if (!provider?.cancel) throw notIntegratedError('Cancelamento de NFS-e');

  const proof = assertAuthorized(
    await provider.cancel({
      nfseId: nfse.id,
      officeId: actor.officeId,
      protocol: nfse.codigoVerificacao ?? nfse.numero,
      motivo: reason,
    }),
    'Cancelamento de NFS-e',
  );

  const claimed = await db.nfseServico.updateMany({
    where: { id: nfse.id, officeId: actor.officeId, status: NFSE_ISSUED_STATUS, deleted: false },
    data: {
      status: NFSE_CANCELLED_STATUS,
      motivoCancelamento: reason,
    },
  });
  if (claimed.count !== 1) {
    throw new FiscalError('NFS-e alterada por outra operação. Recarregue.', 409, 'CONCURRENT_CHANGE');
  }

  await auditLog({
    action: 'NFSE_CANCELLED',
    entity: 'NfseServico',
    entityId: nfse.id,
    details: JSON.stringify({
      numero: nfse.numero,
      reason,
      provider: provider.name,
      protocol: proof.protocol,
      environment: proof.environment,
    }),
    userId: actor.userId,
    officeId: actor.officeId,
  });

  const updated = await db.nfseServico.findFirst({ where: { id: nfse.id, officeId: actor.officeId } });
  return { nfse: updated ?? nfse, alreadyCancelled: false };
}
