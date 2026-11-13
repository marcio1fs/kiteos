import { describe, expect, it, vi } from 'vitest';
import { adjustStock, CommercialError, toCents, moneySchema, quantitySchema } from '@/lib/commercial';

function txWithPart(part: Record<string, unknown>, updateCount = 1) {
  return {
    part: {
      findFirst: vi.fn(async () => part),
      updateMany: vi.fn(async () => ({ count: updateCount })),
    },
    stockMovement: { create: vi.fn(async (a: { data: unknown }) => ({ id: 'mov-1', ...(a.data as object) })) },
  } as never;
}

const part = { id: 'part-A', officeId: 'office-A', description: 'Peça', quantity: 10, costPrice: 5, version: 3, deleted: false };

describe('adjustStock', () => {
  it('scopes the conditional UPDATE by tenant, version and available balance', async () => {
    const tx = txWithPart(part);
    await adjustStock(tx, { officeId: 'office-A', partId: 'part-A', delta: -3, reason: 'Venda', reference: 'SALE:1' });
    const args = (tx as unknown as { part: { updateMany: ReturnType<typeof vi.fn> } }).part.updateMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ id: 'part-A', officeId: 'office-A', version: 3 });
    expect(String(args.where.quantity.gte)).toBe('3');
    expect(Number(args.data.quantity)).toBe(7);
    expect(args.data.version).toEqual({ increment: 1 });
  });

  it('rolls back (throws) when a concurrent writer changed the version', async () => {
    const tx = txWithPart(part, 0);
    await expect(adjustStock(tx, { officeId: 'office-A', partId: 'part-A', delta: -3, reason: 'Venda', reference: 'SALE:1' }))
      .rejects.toBeInstanceOf(CommercialError);
    expect((tx as unknown as { stockMovement: { create: ReturnType<typeof vi.fn> } }).stockMovement.create).not.toHaveBeenCalled();
  });

  it('rejects oversell before writing', async () => {
    const tx = txWithPart({ ...part, quantity: 2 });
    await expect(adjustStock(tx, { officeId: 'office-A', partId: 'part-A', delta: -3, reason: 'Venda', reference: 'SALE:1' }))
      .rejects.toThrow(/Estoque insuficiente/);
  });

  it('rejects parts from another tenant', async () => {
    const tx = txWithPart(null as never);
    await expect(adjustStock(tx, { officeId: 'office-B', partId: 'part-A', delta: -1, reason: 'Venda', reference: 'x' }))
      .rejects.toThrow(/não encontrada nesta oficina/);
  });
});

describe('money/quantity validation', () => {
  it('rejects negative quantities and sub-cent money', () => {
    expect(quantitySchema.safeParse(-1).success).toBe(false);
    expect(quantitySchema.safeParse(0).success).toBe(false);
    expect(moneySchema.safeParse(10.005).success).toBe(false);
    expect(moneySchema.safeParse(10.01).success).toBe(true);
    expect(toCents(10.01)).toBe(1001);
  });
});
