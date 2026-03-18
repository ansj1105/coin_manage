import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { AlertService } from '../src/application/services/alert-service.js';
import { WithdrawService } from '../src/application/services/withdraw-service.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';

const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACKED_DEPOSIT_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';

describe('withdraw external sync auditing', () => {
  let deps: ReturnType<typeof createAppDependencies>;

  beforeEach(async () => {
    deps = createAppDependencies({
      tronGateway: new MockTronGateway()
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
  });

  it('records audit logs and sends an alert when foxya callback sync fails', async () => {
    const notifier = { sendMessage: vi.fn(async () => undefined) };
    const syncClient = {
      syncWithdrawalState: vi.fn(async () => {
        throw new Error('foxya callback unavailable');
      })
    };
    const service = new WithdrawService(
      deps.ledger,
      { publish: vi.fn() } as any,
      new MockTronGateway(),
      new AlertService(notifier as any),
      deps.withdrawJobQueue,
      undefined,
      undefined,
      undefined,
      syncClient
    );

    const result = await service.request({
      userId: 'user-1',
      amountKori: 10,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'withdraw-sync-failure-1'
    });

    const logs = await deps.operationsService.listAuditLogs({
      entityType: 'withdrawal',
      entityId: result.withdrawal.withdrawalId
    });

    expect(syncClient.syncWithdrawalState).toHaveBeenCalledOnce();
    expect(logs.map((log) => log.action)).toContain('withdraw.external_sync.failed');
    expect(logs.find((log) => log.action === 'withdraw.external_sync.failed')?.metadata.error).toContain(
      'foxya callback unavailable'
    );
    expect(notifier.sendMessage).toHaveBeenCalled();
  });
});
