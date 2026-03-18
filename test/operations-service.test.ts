import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';
import { InMemoryMonitoringRepository } from '../src/infrastructure/persistence/in-memory-monitoring-repository.js';
import { InMemoryWithdrawJobQueue } from '../src/infrastructure/queue/in-memory-withdraw-job-queue.js';
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

  it('queues low-risk withdrawals for manual review and writes audit logs', async () => {
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
    expect(processed.autoApproved).toBe(0);
    expect(processed.reviewQueued).toBe(1);

    const stored = await deps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(stored?.status).toBe('PENDING_ADMIN');
    expect(stored?.approvalCount).toBe(0);
    expect(stored?.reviewRequiredAt).toBeTruthy();

    const logs = await deps.operationsService.listAuditLogs({
      entityType: 'withdrawal',
      entityId: request.withdrawal.withdrawalId
    });
    expect(logs.map((log) => log.action)).toContain('withdraw.requested');
    expect(logs.map((log) => log.action)).toContain('withdraw.review_required');
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

    await (deps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain();
    const completed = await deps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(completed?.status).toBe('COMPLETED');

    const approvals = await deps.withdrawService.listApprovals(request.withdrawal.withdrawalId);
    expect(approvals).toHaveLength(2);
  });

  it('reflects completed withdrawals in ledger summary without counting them as active', async () => {
    const requested = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 100,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'ledger-summary-withdraw-1',
      clientIp: '127.0.0.1',
      deviceId: 'device-1'
    });

    let report = await deps.operationsService.getReconciliationReport();
    expect(report.ledger.availableBalance).toBe('59900.000000');
    expect(report.ledger.lockedBalance).toBe('100.000000');
    expect(report.ledger.liabilityBalance).toBe('60000.000000');
    expect(report.ledger.activeWithdrawalCount).toBe(1);

    await deps.withdrawService.confirmExternalAuth(requested.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'ledger-summary-auth-1'
    });
    await deps.withdrawService.approve(requested.withdrawal.withdrawalId, {
      adminId: 'admin-1',
      note: 'approve for ledger summary'
    });
    await (deps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain();

    report = await deps.operationsService.getReconciliationReport();
    expect(report.ledger.availableBalance).toBe('59900.000000');
    expect(report.ledger.lockedBalance).toBe('0.000000');
    expect(report.ledger.liabilityBalance).toBe('59900.000000');
    expect(report.ledger.activeWithdrawalCount).toBe(0);
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

  it('seeds withdrawal queue recovery from persisted withdrawal states', async () => {
    const request = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 120,
      toAddress: VALID_TRON_ADDRESS,
      idempotencyKey: 'recovery-seed-1',
      clientIp: '127.0.0.1',
      deviceId: 'device-1'
    });

    await deps.withdrawService.confirmExternalAuth(request.withdrawal.withdrawalId, {
      provider: 'coin_cloud_system',
      requestId: 'recovery-seed-auth-1'
    });
    await deps.withdrawService.approve(request.withdrawal.withdrawalId, {
      adminId: 'admin-1',
      note: 'approve for recovery'
    });

    const seeded = await deps.operationsService.seedWithdrawalQueueRecovery();
    expect(seeded.approvedCount).toBeGreaterThanOrEqual(1);

    await (deps.withdrawJobQueue as InMemoryWithdrawJobQueue).drain();
    const completed = await deps.withdrawService.get(request.withdrawal.withdrawalId);
    expect(completed?.status).toBe('COMPLETED');
  });

  it('summarizes recent external withdrawal sync failures for system status', async () => {
    await deps.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: 'wd-sync-ok',
      action: 'withdraw.external_sync.succeeded',
      actorType: 'system',
      actorId: 'foxya-withdrawal-sync',
      metadata: {
        status: 'COMPLETED',
        occurredAt: '2026-03-18T12:00:00.000Z',
        txHash: 'tx-ok'
      }
    });
    await deps.ledger.appendAuditLog({
      entityType: 'withdrawal',
      entityId: 'wd-sync-failed',
      action: 'withdraw.external_sync.failed',
      actorType: 'system',
      actorId: 'foxya-withdrawal-sync',
      metadata: {
        status: 'TX_BROADCASTED',
        occurredAt: '2026-03-18T12:01:00.000Z',
        txHash: 'tx-failed',
        error: 'foxya timeout'
      }
    });

    const summary = await deps.operationsService.getWithdrawalExternalSyncStatus();

    expect(summary.totalEvents).toBe(2);
    expect(summary.successCount).toBe(1);
    expect(summary.failureCount).toBe(1);
    expect(summary.failedJobCount).toBe(0);
    expect(summary.lastFailedJob).toBeNull();
    expect(summary.lastFailure).toMatchObject({
      withdrawalId: 'wd-sync-failed',
      status: 'TX_BROADCASTED',
      error: 'foxya timeout'
    });
  });

  it('queues manual external sync retries and records audit logs', async () => {
    const result = await deps.operationsService.retryExternalSyncWithdrawals(
      [
        '2f1ac758-2bce-47dd-8eaf-ffae13845657',
        'f0bb7a31-b4ab-46e5-a625-f21dd1c0f3b1',
        '2f1ac758-2bce-47dd-8eaf-ffae13845657'
      ],
      'ops-admin-1'
    );

    expect(result).toEqual({
      queuedCount: 2,
      withdrawalIds: [
        '2f1ac758-2bce-47dd-8eaf-ffae13845657',
        'f0bb7a31-b4ab-46e5-a625-f21dd1c0f3b1'
      ]
    });

    const logs = await deps.operationsService.listAuditLogs({
      entityType: 'withdrawal',
      entityId: '2f1ac758-2bce-47dd-8eaf-ffae13845657'
    });
    expect(logs[0]).toMatchObject({
      action: 'withdraw.external_sync.retry_requested',
      actorId: 'ops-admin-1'
    });
  });
});
