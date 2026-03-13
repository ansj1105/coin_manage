import { describe, expect, it, vi } from 'vitest';
import { AccountReconciliationService } from '../src/application/services/account-reconciliation-service.js';

describe('AccountReconciliationService', () => {
  it('reconciles deposits for a bound wallet and refreshes account state', async () => {
    const ledger = {
      getWalletBinding: vi.fn(async () => ({
        userId: '1',
        walletAddress: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      })),
      getAccountByWalletAddress: vi.fn(async () => ({
        userId: '1',
        walletAddress: 'TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z',
        balance: 50_000_000n,
        lockedBalance: 0n,
        updatedAt: new Date().toISOString()
      }))
    };
    const depositMonitorService = {
      reconcile: vi.fn(async () => ({
        scannedEvents: 1,
        watchedAddresses: 1,
        matchedEvents: 1,
        registeredCount: 1,
        completedCount: 1,
        skippedCount: 0,
        currentBlockNumber: 123,
        cursorTimestampMs: Date.now()
      }))
    };
    const withdrawService = {
      reconcileBroadcasted: vi.fn(async () => ({
        confirmed: [],
        failed: [],
        pending: []
      }))
    };

    const service = new AccountReconciliationService(
      ledger as any,
      depositMonitorService as any,
      withdrawService as any
    );

    const result = await service.reconcile({
      userId: '1',
      txHashes: ['19f21f61390844f132ce0173d352f9f770b6c364a111242a079521c9b4476262'],
      lookbackMs: 604800000
    });

    expect(depositMonitorService.reconcile).toHaveBeenCalledWith({
      lookbackMs: 604800000,
      addresses: ['TYteNy9PWTg9U68dnjwNnosQC9FP1Hgs1Z'],
      txHashes: ['19f21f61390844f132ce0173d352f9f770b6c364a111242a079521c9b4476262']
    });
    expect(result.balance).toBe('50.000000');
  });
});
