import { describe, expect, it, vi } from 'vitest';
import type { FoxyaTokenDepositLedgerSyncCandidate } from '../src/application/ports/foxya-token-deposit-ledger-sync-repository.js';
import { FoxyaTokenDepositLedgerSyncService } from '../src/application/services/foxya-token-deposit-ledger-sync-service.js';
import { InMemoryFoxyaTokenDepositLedgerSyncCursorRepository } from '../src/infrastructure/persistence/in-memory-foxya-token-deposit-ledger-sync-cursor-repository.js';

const makeCandidate = (
  overrides: Partial<FoxyaTokenDepositLedgerSyncCandidate> = {}
): FoxyaTokenDepositLedgerSyncCandidate => ({
  foxyaId: 100,
  depositId: 'foxya-deposit-100',
  userId: '77',
  currencyCode: 'KORI',
  amount: '1.234567',
  txHash: 'tx-100',
  toAddress: 'TXReceiver',
  blockNumber: 12345,
  confirmedAt: '2026-06-11 00:33:50.958943',
  ...overrides
});

const makeLedger = (input?: {
  duplicated?: boolean;
  status?: 'CREDITED' | 'COMPLETED';
}) => {
  const duplicated = input?.duplicated ?? false;
  const status = input?.status ?? 'CREDITED';

  return {
    applyDeposit: vi.fn(async () => ({
      duplicated,
      deposit: {
        depositId: 'ledger-deposit-1',
        userId: '77',
        txHash: 'tx-100',
        amount: 1_234_567n,
        status,
        blockNumber: 12345,
        createdAt: '2026-06-11T00:33:50.958Z'
      }
    })),
    completeDeposit: vi.fn(async () => ({
      depositId: 'ledger-deposit-1',
      userId: '77',
      txHash: 'tx-100',
      amount: 1_234_567n,
      status: 'COMPLETED',
      blockNumber: 12345,
      createdAt: '2026-06-11T00:33:50.958Z'
    }))
  };
};

describe('FoxyaTokenDepositLedgerSyncService', () => {
  it('applies completed KORI token deposits to the ledger and completes them', async () => {
    const cursorRepository = new InMemoryFoxyaTokenDepositLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedTokenDeposits: vi.fn(async () => [makeCandidate()])
    };
    const ledger = makeLedger();
    const service = new FoxyaTokenDepositLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle(100);
    const cursor = await cursorRepository.getCursor('foxya_token_deposits:KORI');

    expect(result).toMatchObject({
      checkedCount: 1,
      syncedCount: 1,
      duplicatedCount: 0,
      failedCount: 0,
      cursorAdvanced: true
    });
    expect(sourceRepository.listCompletedTokenDeposits).toHaveBeenCalledWith({
      currencyCode: 'KORI',
      cursor: undefined,
      limit: 100
    });
    expect(ledger.applyDeposit).toHaveBeenCalledWith({
      userId: '77',
      amount: 1_234_567n,
      txHash: 'tx-100',
      toAddress: 'TXReceiver',
      walletAddress: 'TXReceiver',
      blockNumber: 12345
    });
    expect(ledger.completeDeposit).toHaveBeenCalledWith('ledger-deposit-1');
    expect(cursor).toMatchObject({
      lastConfirmedAt: '2026-06-11 00:33:50.958943',
      lastFoxyaId: 100
    });
  });

  it('uses ledger idempotency and does not re-complete already completed duplicates', async () => {
    const cursorRepository = new InMemoryFoxyaTokenDepositLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedTokenDeposits: vi.fn(async () => [makeCandidate()])
    };
    const ledger = makeLedger({ duplicated: true, status: 'COMPLETED' });
    const service = new FoxyaTokenDepositLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle(100);

    expect(result.duplicatedCount).toBe(1);
    expect(result.syncedCount).toBe(0);
    expect(ledger.completeDeposit).not.toHaveBeenCalled();
  });

  it('skips unsupported currencies without crediting KORI ledger', async () => {
    const cursorRepository = new InMemoryFoxyaTokenDepositLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedTokenDeposits: vi.fn(async () => [makeCandidate({ currencyCode: 'TRX' })])
    };
    const ledger = makeLedger();
    const service = new FoxyaTokenDepositLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle(100);
    const cursor = await cursorRepository.getCursor('foxya_token_deposits:KORI');

    expect(result.skippedUnsupportedCount).toBe(1);
    expect(ledger.applyDeposit).not.toHaveBeenCalled();
    expect(cursor?.lastFoxyaId).toBe(100);
  });

  it('fails fast when configured for a currency that the ledger sync does not support yet', async () => {
    const cursorRepository = new InMemoryFoxyaTokenDepositLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedTokenDeposits: vi.fn(async () => [makeCandidate({ currencyCode: 'TRX' })])
    };
    const ledger = makeLedger();
    const service = new FoxyaTokenDepositLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'TRX' }
    );

    await expect(service.runCycle(100)).rejects.toThrow('unsupported foxya token deposit ledger sync currency: TRX');
    expect(sourceRepository.listCompletedTokenDeposits).not.toHaveBeenCalled();
    expect(ledger.applyDeposit).not.toHaveBeenCalled();
  });

  it('does not advance past a failed candidate', async () => {
    const cursorRepository = new InMemoryFoxyaTokenDepositLedgerSyncCursorRepository();
    const sourceRepository = {
      listCompletedTokenDeposits: vi.fn(async () => [
        makeCandidate({ foxyaId: 100, amount: '1.000000', txHash: 'tx-100' }),
        makeCandidate({ foxyaId: 101, amount: '1.0000001', txHash: 'tx-101' })
      ])
    };
    const ledger = makeLedger();
    const service = new FoxyaTokenDepositLedgerSyncService(
      sourceRepository,
      cursorRepository,
      ledger as any,
      { currencyCode: 'KORI' }
    );

    const result = await service.runCycle(100);
    const cursor = await cursorRepository.getCursor('foxya_token_deposits:KORI');

    expect(result.checkedCount).toBe(2);
    expect(result.syncedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(cursor?.lastFoxyaId).toBe(100);
  });
});
