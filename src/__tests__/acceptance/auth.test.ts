import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const model = () => ({
    findFirst: vi.fn(), findUnique: vi.fn(),
    create: vi.fn(async (a: { data: Record<string, unknown> }) => ({ id: 'created', ...a.data })),
    update: vi.fn(async (a: { where: unknown; data: Record<string, unknown> }) => ({ ...(a.where as object), ...a.data })),
    updateMany: vi.fn(async () => ({ count: 1 })),
  });
  const names = ['user', 'office', 'refreshToken', 'tokenBlacklist', 'auditLog'];
  const db: Record<string, ReturnType<typeof model>> = Object.fromEntries(names.map(n => [n, model()]));
  (db as unknown as { $transaction: ReturnType<typeof vi.fn> }).$transaction = vi.fn(async (fn: (tx: unknown) => unknown) => fn(db));
  return { db };
});
vi.mock('@/lib/db', () => ({ db: h.db }));

import { signToken, requireAuth, requirePlatformAdmin, isPlatformAdmin, rotateRefreshToken } from '@/lib/auth';

const officeId = 'office-A';
const activeUser = {
  id: 'user-A', role: 'OWNER', active: true, deleted: false, officeId,
  office: { id: officeId, active: true, deleted: false },
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.JWT_SECRET = 'test-secret-with-at-least-32-characters-long';
  process.env.PLATFORM_ADMIN_USER_IDS = 'platform-1';
  h.db.tokenBlacklist.findFirst.mockResolvedValue(null);
  h.db.user.findUnique.mockResolvedValue(activeUser);
});

async function requestFor(userId = 'user-A', role = 'OWNER') {
  const token = await signToken({ userId, role, officeId });
  return new Request('https://test.invalid/api/x', { headers: { Authorization: `Bearer ${token}` } });
}

describe('session revalidation', () => {
  it('accepts an active user with a matching tenant', async () => {
    const auth = await requireAuth(await requestFor(), officeId);
    expect(auth.payload?.userId).toBe('user-A');
  });

  it('rejects a deactivated user even with a valid JWT', async () => {
    h.db.user.findUnique.mockResolvedValue({ ...activeUser, active: false });
    const auth = await requireAuth(await requestFor(), officeId);
    expect(auth.payload).toBeNull();
  });

  it('rejects a token whose tenant no longer matches the user', async () => {
    h.db.user.findUnique.mockResolvedValue({ ...activeUser, officeId: 'office-B', office: { id: 'office-B', active: true, deleted: false } });
    const auth = await requireAuth(await requestFor(), officeId);
    expect(auth.payload).toBeNull();
  });

  it('uses the current role from the database, not the stale JWT claim', async () => {
    h.db.user.findUnique.mockResolvedValue({ ...activeUser, role: 'EMPLOYEE' });
    const auth = await requireAuth(await requestFor('user-A', 'OWNER'), officeId, 'ADMIN');
    expect(auth.payload).toBeNull();
  });
});

describe('platform admin gate', () => {
  it('tenant OWNER is not a platform admin by default', async () => {
    const auth = await requirePlatformAdmin(await requestFor());
    expect(auth.payload).toBeNull();
    expect(isPlatformAdmin('user-A')).toBe(false);
  });

  it('only explicitly listed operators pass', async () => {
    h.db.user.findUnique.mockResolvedValue({ ...activeUser, id: 'platform-1' });
    const auth = await requirePlatformAdmin(await requestFor('platform-1'));
    expect(auth.payload?.userId).toBe('platform-1');
  });
});

describe('refresh token rotation', () => {
  it('detects reuse of a revoked token and revokes the family', async () => {
    h.db.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', token: 'old', userId: 'user-A', officeId, role: 'OWNER', isRevoked: true, expiresAt: new Date(Date.now() + 100000),
    });
    const result = await rotateRefreshToken('old');
    expect(result).toBeNull();
    expect(h.db.refreshToken.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userId: 'user-A', isRevoked: false },
      data: expect.objectContaining({ reason: 'TOKEN_THEFT_DETECTED' }),
    }));
    expect(h.db.tokenBlacklist.create).toHaveBeenCalled();
  });

  it('consumes the old token with a CAS before issuing a new one', async () => {
    h.db.refreshToken.findUnique.mockResolvedValue({
      id: 'rt-1', token: 'old', userId: 'user-A', officeId, role: 'OWNER', isRevoked: false, expiresAt: new Date(Date.now() + 100000),
    });
    const result = await rotateRefreshToken('old');
    expect(result).not.toBeNull();
    const cas = h.db.refreshToken.updateMany.mock.calls[0][0];
    expect(cas.where).toMatchObject({ id: 'rt-1', isRevoked: false });
    expect(h.db.refreshToken.create).toHaveBeenCalledTimes(1);
  });
});
