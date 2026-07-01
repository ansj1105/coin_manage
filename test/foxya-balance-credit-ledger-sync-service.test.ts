import { describe, expect, it, vi } from 'vitest';
import type { FoxyaBalanceCreditLedgerSyncCandidate } from '../src/application/ports/foxya-balance-credit-ledger-sync-repository.js';
import { FoxyaBalanceCreditLedgerSyncService } from '../src/application/services/foxya-balance-credit-ledger-sync-service.js';
import { InMemoryFoxyaBalanceCreditLedgerSyncCursorRepository } from '../src/infrastructure/persistence/in-memory-foxya-balance-credit-ledger-sync-cursor-repository.js';

const makeCandidate = (
  overrides: Partial<FoxyaBalanceCreditLedgerSyncCandidate> = {}
): FoxyaBalanceCreditLedgerSyncCandidate => ({
  sourceName: 'mining_history',
  foxyaId: 100,
  userId: '77',
  currencyCode: 'KORI',
  amount: '1.234567',
  occurredAt: '2026-07-01 11:22:33.123456',
  journalType: 'foxya_mining_credited',
  referenceType: 'foxya_mining_history',
  referenceId: 'foxya_mining_history:100',
  description: 'foxya mining history 100',
  ...overrides
});

const makeLedger = (input?: { duplicated?: boolean; failOnAmount?: bigint }) => ({
  applyExternalCredit: vi.fn(async (credit: { amount: bigint; referenceId: string }) => {
    if (input?.failOnAmount === credit.amount) {
      throw new Error('boom');
    }
    return {
      creditId: credit.referenceId,
      userId: '77',
      amount: credit.amount,
      currencyCode: 'KORI',
      journalType: 'foxya_mining_credited',
      referenceType: 'foxya_mining_history',
      referenceId: credit.referenceId,
      duplicated: input?.duplicated ?? false,
      createdAt: '2026-07-01T11:22:33.123Z'
    };
  })
});

describe('FoxyaBalanceCreditLedgerSyncService', () => {
  it('applies completed Foxya KORI credits to the ledger', async () => {
    const cursorRepository = new InMemoryFoxyaBalanceCreditLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedCredits: vi.fn(async () => [makeCandidate()])
    };
    const ledger = makeLedger();
    const service = new FoxyaBalanceCreditLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle('mining_history', 100);
    const cursor = await cursorRepository.getCursor('foxya_balance_credit:mining_history:KORI');

    expect(result).toMatchObject({
      sourceName: 'mining_history',
      checkedCount: 1,
      syncedCount: 1,
      duplicatedCount: 0,
      failedCount: 0,
      cursorAdvanced: true
    });
    expect(sourceRepository.listCompletedCredits).toHaveBeenCalledWith({
      sourceName: 'mining_history',
      currencyCode: 'KORI',
      cursor: undefined,
      limit: 100
    });
    expect(ledger.applyExternalCredit).toHaveBeenCalledWith({
      userId: '77',
      amount: 1_234_567n,
      currencyCode: 'KORI',
      journalType: 'foxya_mining_credited',
      referenceType: 'foxya_mining_history',
      referenceId: 'foxya_mining_history:100',
      description: 'foxya mining history 100',
      nowIso: '2026-07-01 11:22:33.123456'
    });
    expect(cursor).toMatchObject({
      sourceName: 'mining_history',
      currencyCode: 'KORI',
      lastOccurredAt: '2026-07-01 11:22:33.123456',
      lastFoxyaId: 100
    });
  });

  it('counts idempotent ledger duplicates while advancing the cursor', async () => {
    const cursorRepository = new InMemoryFoxyaBalanceCreditLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedCredits: vi.fn(async () => [makeCandidate()])
    };
    const ledger = makeLedger({ duplicated: true });
    const service = new FoxyaBalanceCreditLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle('mining_history', 100);
    const cursor = await cursorRepository.getCursor('foxya_balance_credit:mining_history:KORI');

    expect(result.duplicatedCount).toBe(1);
    expect(result.syncedCount).toBe(0);
    expect(cursor?.lastFoxyaId).toBe(100);
  });

  it('does not advance past a failed candidate', async () => {
    const cursorRepository = new InMemoryFoxyaBalanceCreditLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedCredits: vi.fn(async () => [
        makeCandidate({ foxyaId: 100, amount: '1.000000', referenceId: 'foxya_mining_history:100' }),
        makeCandidate({ foxyaId: 101, amount: '1.000001', referenceId: 'foxya_mining_history:101' })
      ])
    };
    const ledger = makeLedger({ failOnAmount: 1_000_001n });
    const service = new FoxyaBalanceCreditLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle('mining_history', 100);
    const cursor = await cursorRepository.getCursor('foxya_balance_credit:mining_history:KORI');

    expect(result.checkedCount).toBe(2);
    expect(result.syncedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(cursor?.lastFoxyaId).toBe(100);
  });

  it('skips unexpected currencies without crediting KORI ledger', async () => {
    const cursorRepository = new InMemoryFoxyaBalanceCreditLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedCredits: vi.fn(async () => [makeCandidate({ currencyCode: 'TRX' })])
    };
    const ledger = makeLedger();
    const service = new FoxyaBalanceCreditLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle('mining_history', 100);
    const cursor = await cursorRepository.getCursor('foxya_balance_credit:mining_history:KORI');

    expect(result.skippedUnsupportedCount).toBe(1);
    expect(ledger.applyExternalCredit).not.toHaveBeenCalled();
    expect(cursor?.lastFoxyaId).toBe(100);
  });
});
