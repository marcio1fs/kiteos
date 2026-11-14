/**
 * Portas de integração com os órgãos fiscais.
 *
 * O ponto desta separação é tornar explícito o que **não** existe: sem um
 * provedor configurado, nenhum documento pode virar `EMITIDA` (ver
 * `document-status.ts`). Antes desta mudança o sistema gravava o status
 * autorizado sem nunca ter falado com município ou SEFAZ.
 *
 * Homologação é dependência externa e não pode ser simulada: exige certificado
 * A1 real, município piloto (NFS-e) e credenciamento/ambiente de homologação
 * (NF-e). O que está pronto aqui é o contrato e a máquina de estados — o
 * adaptador concreto entra quando houver com quem homologar.
 */

import { db } from '@/lib/db';
import type { AuthorizationProof } from './document-status';

export type NfseTransmissionInput = {
  /** Id da NFS-e (RPS) no banco. */
  nfseId: string;
  officeId: string;
  /** XML do RPS a transmitir. */
  xml: string;
  numero: string;
  competencia: string | null;
};

export type NfseCancellationInput = {
  nfseId: string;
  officeId: string;
  /** Protocolo/código que o município devolveu na autorização. */
  protocol: string;
  motivo: string;
};

/** Adaptador de um provedor de NFS-e (ABRASF, Ginfes, Focus, Betha, ISS.net…). */
export interface NfseProvider {
  readonly name: string;
  /** Transmite o RPS e devolve a prova de autorização (número + código de verificação). */
  transmit(input: NfseTransmissionInput): Promise<AuthorizationProof>;
  /** Solicita o cancelamento de uma NFS-e autorizada. */
  cancel?(input: NfseCancellationInput): Promise<AuthorizationProof>;
}

/**
 * Nenhum provedor de NFS-e está integrado.
 *
 * O parâmetro existe porque a resolução será por oficina (cada município usa um
 * provedor diferente) e porque os testes injetam um stub para exercitar a máquina
 * de estados de ponta a ponta. Devolver `null` é o comportamento honesto hoje: a
 * rota responde `501 PROVIDER_NOT_INTEGRATED` e o documento continua RPS.
 */
export async function resolveNfseProvider(officeId: string): Promise<NfseProvider | null> {
  void officeId;
  return null;
}

/**
 * Certificado A1 ativo da oficina, se houver — pré-requisito de qualquer
 * transmissão fiscal real (NF-e/NFS-e) e da consulta SEFAZ na importação.
 */
export async function resolveActiveCertificate(officeId: string) {
  return db.certificadoDigital.findFirst({
    where: {
      officeId,
      ativo: true,
      deleted: false,
      OR: [{ validade: null }, { validade: { gte: new Date() } }],
    },
    orderBy: { createdAt: 'desc' },
  });
}
