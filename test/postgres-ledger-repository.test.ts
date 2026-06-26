import { describe, expect, it, vi } from 'vitest';
import { PostgresLedgerRepository } from '../src/infrastructure/persistence/postgres/postgres-ledger-repository.js';

describe('postgres ledger repository', () => {
  it('uses the KORION PAY 0.1% included-fee policy for offline settlements', () => {
    const repository = new PostgresLedgerRepository({} as any, {
      singleLimit: 0n,
      dailyLimit: 0n
    });
    const calculateFee = (repository as any).calculateOfflinePaySettlementFee.bind(repository);

    expect(calculateFee('KORI', 10_000000n)).toBe(10_000n);
    expect(calculateFee('KORI', 150_000000n)).toBe(150_000n);
  });

  it('does not create positive wallet reconciliation credit for existing offline-pay users', async () => {
    const repository = new PostgresLedgerRepository({} as any, {
      singleLimit: 0n,
      dailyLimit: 0n
    }) as any;

    repository.withTransaction = async (work: (trx: unknown) => Promise<unknown>) => work({} as never);
    repository.ensureAccount = vi.fn(async () => undefined);
    repository.getAccountForUpdate = vi.fn(async () => undefined);
    repository.getProjectedUserBalances = vi.fn(async () => ({
      balance: 80_000000n,
      lockedBalance: 5_000000n,
      hasPostings: true
    }));
    repository.hasOfflinePayLedgerFootprintIn = vi.fn(async () => true);
    repository.appendJournal = vi.fn(async () => undefined);
    repository.syncUserAccountProjection = vi.fn(async () => undefined);

    await expect(repository.reconcileOfflinePayUserBalance({
      userId: '1761',
      targetLiabilityBalance: 100_000000n,
      canonicalBasis: 'FOX_CLIENT_VISIBLE_TOTAL_KORI',
      actorId: 'test',
      nowIso: '2026-06-26T00:00:00.000Z'
    })).resolves.toEqual({
      userId: '1761',
      previousLiabilityBalance: 85_000000n,
      targetLiabilityBalance: 100_000000n,
      deltaAmount: 15_000000n,
      adjusted: false
    });
    expect(repository.appendJournal).not.toHaveBeenCalled();
    expect(repository.syncUserAccountProjection).not.toHaveBeenCalled();
  });
});
