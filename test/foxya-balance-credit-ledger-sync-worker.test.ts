import { describe, expect, it, vi } from 'vitest';
import { FoxyaBalanceCreditLedgerSyncWorker } from '../src/application/services/foxya-balance-credit-ledger-sync-worker.js';

const makeResult = (sourceName: 'mining_history' | 'airdrop_transfer') => ({
  sourceName,
  checkedCount: 0,
  syncedCount: 0,
  duplicatedCount: 0,
  skippedUnsupportedCount: 0,
  failedCount: 0,
  cursorAdvanced: false
});

describe('FoxyaBalanceCreditLedgerSyncWorker', () => {
  it('stagger-starts each Foxya credit source by the configured source gap', async () => {
    vi.useFakeTimers();
    const service = {
      runCycle: vi.fn(async (sourceName: 'mining_history' | 'airdrop_transfer') => makeResult(sourceName))
    };
    const alertService = {
      notifyFoxyaTokenDepositLedgerSyncFailure: vi.fn()
    };
    const worker = new FoxyaBalanceCreditLedgerSyncWorker(
      service as any,
      alertService as any,
      60_000,
      100,
      ['mining_history', 'airdrop_transfer'],
      1_000,
      2_000
    );

    try {
      worker.start();

      await vi.advanceTimersByTimeAsync(999);
      expect(service.runCycle).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(service.runCycle).toHaveBeenCalledTimes(1);
      expect(service.runCycle).toHaveBeenLastCalledWith('mining_history', 100);

      await vi.advanceTimersByTimeAsync(1_999);
      expect(service.runCycle).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(service.runCycle).toHaveBeenCalledTimes(2);
      expect(service.runCycle).toHaveBeenLastCalledWith('airdrop_transfer', 100);
    } finally {
      worker.stop();
      vi.useRealTimers();
    }
  });
});
