import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { logger } from '@/lib/logger';
import { requireAuth, revokeAllUserTokens, addToTokenBlacklist, auditLog } from '@/lib/auth';

/**
 * POST /api/auth/gdpr-delete
 * LGPD/GDPR Right to be Forgotten - Request deletion of personal data
 *
 * This endpoint allows users to request complete deletion of their personal data.
 * The process:
 * 1. Verify the user is authenticated and requesting their own data deletion
 * 2. Anonymize personal data (keep records for legal/fiscal compliance but remove PII)
 * 3. Revoke all sessions
 * 4. Log the deletion request for compliance tracking
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if (!auth.payload) {
      return NextResponse.json(
        { success: false, error: auth.error.message },
        { status: auth.error.status }
      );
    }

    const { userId, officeId, role } = auth.payload;
    const body = await request.json();
    const { confirmation, targetUserId } = body;

    // Can only delete own data unless OWNER requesting deletion of office data
    const isSelfDelete = !targetUserId || targetUserId === userId;

    if (!isSelfDelete && role !== 'OWNER') {
      return NextResponse.json(
        { success: false, error: 'Apenas o proprietário pode solicitar a exclusão de dados de terceiros' },
        { status: 403 }
      );
    }

    const deleteUserId = isSelfDelete ? userId : targetUserId;

    // Require explicit confirmation phrase
    if (confirmation !== 'EXCLUIR_MEUS_DADOS') {
      return NextResponse.json(
        { success: false, error: 'Confirmação necessária. Envie confirmation: "EXCLUIR_MEUS_DADOS" para confirmar a exclusão.' },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { id: deleteUserId },
      include: { office: true },
    });

    if (!user) {
      return NextResponse.json(
        { success: false, error: 'Usuário não encontrado' },
        { status: 404 }
      );
    }

    // Verify the target user belongs to the same office
    if (user.officeId !== officeId) {
      return NextResponse.json(
        { success: false, error: 'Acesso negado' },
        { status: 403 }
      );
    }

    await db.$transaction(async (tx) => {
      // 1. Anonymize user data
      await tx.user.update({
        where: { id: deleteUserId },
        data: {
          name: 'USUARIO_EXCLUIDO',
          email: `excluido_${deleteUserId}@anonimizado.kiteos`,
          password: 'ANONYMIZED',
          active: false,
          deleted: true,
        },
      });

      // 2. If user is OWNER, anonymize the entire office
      if (role === 'OWNER' && isSelfDelete) {
        await tx.office.update({
          where: { id: officeId },
          data: {
            name: 'OFICINA_EXCLUIDA',
            email: `excluido_${officeId}@anonimizado.kiteos`,
            phone: null,
            cnpj: `ANONIMIZADO_${officeId.substring(0, 8)}`,
            address: null,
            city: null,
            active: false,
            deleted: true,
            mpAccessToken: null,
            mpPublicKey: null,
            mpRefreshToken: null,
            mpWebhookSecret: null,
            waApiToken: null,
            waWebhookSecret: null,
          },
        });

        // Anonymize all users in the office
        const officeUsers = await tx.user.findMany({
          where: { officeId, id: { not: deleteUserId }, deleted: false },
        });

        for (const u of officeUsers) {
          await tx.user.update({
            where: { id: u.id },
            data: {
              name: 'USUARIO_EXCLUIDO',
              email: `excluido_${u.id}@anonimizado.kiteos`,
              password: 'ANONYMIZED',
              active: false,
              deleted: true,
            },
          });
        }

        // Anonymize client data (keep fiscal records but remove PII)
        await tx.client.updateMany({
          where: { officeId, deleted: false },
          data: {
            name: 'CLIENTE_ANONIMIZADO',
            email: null,
            phone: null,
            address: null,
            cpfCnpj: `ANON_${officeId.substring(0, 8)}`,
            deleted: true,
          },
        });

        // Anonymize supplier data
        await tx.supplier.updateMany({
          where: { officeId, deleted: false },
          data: {
            razaoSocial: 'FORNECEDOR_ANONIMIZADO',
            nomeFantasia: 'ANONIMIZADO',
            email: null,
            phone: null,
            cnpj: `ANON_${officeId.substring(0, 8)}`,
            deleted: true,
          },
        });
      }

      // 3. Create compliance audit log
      await tx.auditLog.create({
        data: {
          action: 'GDPR_DATA_DELETION',
          entity: 'User',
          entityId: deleteUserId,
          details: JSON.stringify({
            type: isSelfDelete ? 'SELF_DELETE' : 'OWNER_DELETE',
            targetUserId: deleteUserId,
            officeId,
            anonymizedAt: new Date().toISOString(),
            confirmationProvided: true,
          }),
          officeId,
          userId,
          ipAddress: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
          userAgent: request.headers.get('user-agent') || 'unknown',
        },
      });
    });

    // 4. Revoke all sessions
    await revokeAllUserTokens(deleteUserId);
    await addToTokenBlacklist(deleteUserId, officeId, 'GDPR_DELETION');

    return NextResponse.json({
      success: true,
      data: {
        message: 'Solicitação de exclusão de dados processada com sucesso. Seus dados pessoais foram anonimizados.',
        deletionDate: new Date().toISOString(),
        note: 'Alguns dados fiscais podem ser mantidos em formato anônimo por requisitos legais.',
      },
    });
  } catch (error) {
    logger.error('GDPR deletion error', { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { success: false, error: 'Erro ao processar solicitação de exclusão de dados' },
      { status: 500 }
    );
  }
}
