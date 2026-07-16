import { db } from '@/lib/db';

interface AuditLogData {
  action: string;
  entity: string;
  entityId?: string;
  details?: string;
  userId?: string | null;
  officeId: string;
  invoiceId?: string;
}

/**
 * Safely create an audit log entry.
 * Validates that the user exists before setting userId to avoid FK constraint errors.
 */
export async function createAuditLog(data: AuditLogData) {
  let validUserId: string | null = null;

  if (data.userId) {
    const user = await db.user.findFirst({
      where: { id: data.userId, deleted: false },
      select: { id: true },
    });
    if (user) {
      validUserId = user.id;
    }
  }

  return db.auditLog.create({
    data: {
      action: data.action,
      entity: data.entity,
      entityId: data.entityId || null,
      details: data.details || null,
      userId: validUserId,
      officeId: data.officeId,
      invoiceId: data.invoiceId || null,
    },
  });
}
