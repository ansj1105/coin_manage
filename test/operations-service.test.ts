import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryMonitoringRepository } from '../src/infrastructure/persistence/in-memory-monitoring-repository.js';
import { SystemMonitoringService } from '../src/application/services/system-monitoring-service.js';
import { OperationsService } from '../src/application/services/operations-service.js';
import { getConfiguredSystemWallets } from '../src/config/system-wallets.js';

const VALID_TRON_ADDRESS = 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const TRACKED_DEPOSIT_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';

describe('operations and control flows', () => {
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
      txHash: `seed-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 60000,
      blockNumber: 1
    });
  });

  it('auto-approves low-risk withdrawals through the scheduler queue and writes audit logs', async () => {
    const request = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 10,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'auto-queue-1',
      clientIp: '127.0.0.1',
      deviceId: 'device-1'
    });

    await deps.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'cloud-auto-queue-1'
    });

    const processed = await deps.schedulerService.processWithdrawQueue();
    expect(processed.autoApproved).toBe(1);

    const stored = await deps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(stored?.status).toBe('ADMIN_APPROVED');
    expect(stored?.approvalCount).toBe(1);

    const logs = await deps.operationsService.listAuditLogs({
      entityType: 'withdrawal',
      entityId: request.withdrawal.withdrawalId
    });
    expect(logs.map((log) => log.action)).toContain('withdraw.requested');
    expect(logs.map((log) => log.action)).toContain('withdraw.approved.finalized');
  });

  it('marks high-risk withdrawals for review and finalizes after dual admin approvals', async () => {
    const request = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 9000,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'manual-review-1'
    });

    await deps.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'cloud-manual-review-1'
    });

    const processed = await deps.schedulerService.processWithdrawQueue();
    expect(processed.reviewQueued).toBe(1);

    const reviewRequired = await deps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(reviewRequired?.status).toBe('PENDING_ADMIN');
    expect(reviewRequired?.reviewRequiredAt).toBeTruthy();
    expect(reviewRequired?.requiredApprovals).toBe(2);

    const first = await deps.withdrawService.approve(request.withdrawal.withdrawalId, {
      adminId: 'admin-1',
      note: 'first approval'
    });
    expect(first.finalized).toBe(false);
    expect(first.withdrawal.status).toBe('PENDING_ADMIN');

    const second = await deps.withdrawService.approve(request.withdrawal.withdrawalId, {
      adminId: 'admin-2',
      note: 'second approval'
    });
    expect(second.finalized).toBe(true);
    expect(second.withdrawal.status).toBe('ADMIN_APPROVED');

    const approvals = await deps.withdrawService.listApprovals(request.withdrawal.withdrawalId);
    expect(approvals).toHaveLength(2);
  });

  it('creates sweep plans and reconciliation summary from stored monitoring snapshots', async () => {
    const reader = {
      getWalletMonitoringSnapshot: vi.fn(async (address: string) => ({
        address,
        tokenSymbol: 'KORI',
        tokenContractAddress: 'TCONTRACT',
        tokenBalance: '5.000000',
        tokenRawBalance: '5000000',
        tokenDecimals: 6,
        trxBalance: '200.000000',
        trxRawBalance: '200000000',
        fetchedAt: new Date().toISOString(),
        status: 'ok' as const
      }))
    };
    const monitoringService = new SystemMonitoringService(reader as any, new InMemoryMonitoringRepository(), 0);
    const operationsService = new OperationsService(deps.ledger, monitoringService);

    await monitoringService.collectWallets(getConfiguredSystemWallets());

    const plan = await operationsService.planSweeps();
    expect(plan.plannedCount).toBe(4);

    const firstSweep = plan.sweeps[0];
    const broadcasted = await operationsService.markSweepBroadcasted(firstSweep.sweepId, 'sweep-tx-1', 'manual tx');
    expect(broadcasted.status).toBe('broadcasted');

    const confirmed = await operationsService.confirmSweep(firstSweep.sweepId, 'confirmed on-chain');
    expect(confirmed.status).toBe('confirmed');

    const reconciliation = await operationsService.getReconciliationReport();
    expect(reconciliation.onchain.trackedWalletCount).toBe(6);
    expect(reconciliation.ledger.accountCount).toBeGreaterThanOrEqual(1);
  });
});
