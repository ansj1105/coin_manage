import { describe, expect, it, vi } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryWithdrawJobQueue } from '../src/infrastructure/queue/in-memory-withdraw-job-queue.js';

const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACKED_DEPOSIT_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';

describe('withdraw external sync retry flow', () => {
  it('queues an external sync retry and converges after a later successful callback', async () => {
    const syncClient = {
      syncWithdrawalState: vi
        .fn()
        .mockRejectedValueOnce(new Error('foxya callback unavailable'))
        .mockResolvedValue(undefined)
    };
    const deps = createAppDependencies({
      tronGateway: new MockTronGateway(),
      externalWithdrawalSyncClient: syncClient as any
    });

    await deps.walletService.bindWalletAddress({
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });
    await deps.depositService.processDeposit({
      userId: 'user-1',
      txHash: `sync-seed-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 100,
      blockNumber: 1
    });

    const result = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 10,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'withdraw-sync-retry-1'
    });

    let logs = await deps.operationsService.listAuditLogs({
      entityType: 'withdrawal',
      entityId: result.withdrawal.withdrawalId
    });
    expect(logs.map((log) => log.action)).toContain('withdraw.external_sync.failed');

    await (deps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain();

    logs = await deps.operationsService.listAuditLogs({
      entityType: 'withdrawal',
      entityId: result.withdrawal.withdrawalId
    });

    expect(syncClient.syncWithdrawalState).toHaveBeenCalledTimes(2);
    expect(logs.map((log) => log.action)).toContain('withdraw.external_sync.succeeded');

    const summary = await deps.operationsService.getWithdrawalExternalSyncStatus();
    expect(summary.failureCount).toBeGreaterThanOrEqual(1);
    expect(summary.successCount).toBeGreaterThanOrEqual(1);
    expect(summary.failedJobCount).toBe(0);
  });
});
