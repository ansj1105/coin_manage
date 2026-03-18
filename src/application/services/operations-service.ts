import { env } from '../../config/env.js';
import { getConfiguredSystemWallets } from '../../config/system-wallets.js';
import { formatKoriAmount, parseKoriAmount, parseStoredKoriAmount } from '../../domain/value-objects/money.js';
import type { WithdrawJobQueue } from '../ports/withdraw-job-queue.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { SystemMonitoringService } from './system-monitoring-service.js';
import type { WithdrawPolicyService } from './withdraw-policy-service.js';
import type { WithdrawAddressPolicyType } from '../../domain/withdraw-policy/types.js';

type ExternalSyncFailureItem = {
  withdrawalId: string;
  createdAt: string;
  status: string;
  error: string;
  occurredAt: string;
  txHash: string;
  failedJob: {
    attemptsMade: number;
    failedReason: string;
  } | null;
};

type WithdrawalRiskEventSeverity = 'low' | 'medium' | 'high' | 'critical';

type WithdrawalRiskEvent = {
  eventId: string;
  address: string;
  signal: string;
  severity: WithdrawalRiskEventSeverity;
  reason: string;
  createdAt: string;
  actorId: string;
  blacklistPolicyType: WithdrawAddressPolicyType | null;
};

export class OperationsService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly systemMonitoringService: SystemMonitoringService,
    private readonly withdrawJobQueue: WithdrawJobQueue,
    private readonly withdrawPolicyService?: WithdrawPolicyService
  ) {}

  async listAuditLogs(input?: { entityType?: 'withdrawal' | 'sweep' | 'system'; entityId?: string; limit?: number }) {
    return this.ledger.listAuditLogs(input);
  }

  async listWithdrawalExternalSyncFailures(limit = 50) {
    const [logs, failedJobs] = await Promise.all([
      this.ledger.listAuditLogs({
        entityType: 'withdrawal',
        limit: Math.max(limit * 4, 100)
      }),
      this.withdrawJobQueue.listFailed(limit)
    ]);

    const syncFailedJobs = failedJobs.filter((job) => job.name === 'external_sync');
    const failedJobByWithdrawalId = new Map(
      syncFailedJobs
        .filter((job) => job.withdrawalId)
        .map((job) => [job.withdrawalId as string, job] as const)
    );

    const items: ExternalSyncFailureItem[] = [];
    const seenWithdrawalIds = new Set<string>();

    for (const log of logs) {
      if (log.action !== 'withdraw.external_sync.failed' || seenWithdrawalIds.has(log.entityId)) {
        continue;
      }

      seenWithdrawalIds.add(log.entityId);
      const failedJob = failedJobByWithdrawalId.get(log.entityId);
      items.push({
        withdrawalId: log.entityId,
        createdAt: log.createdAt,
        status: log.metadata.status ?? '',
        error: log.metadata.error ?? '',
        occurredAt: log.metadata.occurredAt ?? '',
        txHash: log.metadata.txHash ?? '',
        failedJob: failedJob
          ? {
              attemptsMade: failedJob.attemptsMade,
              failedReason: failedJob.failedReason ?? ''
            }
          : null
      });

      if (items.length >= limit) {
        break;
      }
    }

    for (const failedJob of syncFailedJobs) {
      if (!failedJob.withdrawalId || seenWithdrawalIds.has(failedJob.withdrawalId)) {
        continue;
      }

      seenWithdrawalIds.add(failedJob.withdrawalId);
      items.push({
        withdrawalId: failedJob.withdrawalId,
        createdAt: '',
        status: '',
        error: failedJob.failedReason ?? '',
        occurredAt: '',
        txHash: '',
        failedJob: {
          attemptsMade: failedJob.attemptsMade,
          failedReason: failedJob.failedReason ?? ''
        }
      });

      if (items.length >= limit) {
        break;
      }
    }

    return {
      items,
      failedJobCount: syncFailedJobs.length
    };
  }

  async getWithdrawalExternalSyncStatus(limit = 200) {
    const [logs, failedJobs] = await Promise.all([
      this.ledger.listAuditLogs({
        entityType: 'withdrawal',
        limit
      }),
      this.withdrawJobQueue.listFailed(limit)
    ]);
    const syncLogs = logs.filter((log) => log.action.startsWith('withdraw.external_sync.'));
    const syncFailedJobs = failedJobs.filter((job) => job.name === 'external_sync');
    const failures = syncLogs.filter((log) => log.action === 'withdraw.external_sync.failed');
    const successes = syncLogs.filter((log) => log.action === 'withdraw.external_sync.succeeded');
    const lastFailure = failures[0];
    const recentFailures = (await this.listWithdrawalExternalSyncFailures(Math.min(limit, 10))).items;

    return {
      enabled: Boolean(env.foxyaInternalWithdrawalApiUrl && env.foxyaInternalWithdrawalApiKey),
      totalEvents: syncLogs.length,
      successCount: successes.length,
      failureCount: failures.length,
      failedJobCount: syncFailedJobs.length,
      recentFailures,
      lastFailure: lastFailure
        ? {
            withdrawalId: lastFailure.entityId,
            createdAt: lastFailure.createdAt,
            status: lastFailure.metadata.status ?? '',
            error: lastFailure.metadata.error ?? ''
          }
        : null,
      lastFailedJob: syncFailedJobs[0]
        ? {
            withdrawalId: syncFailedJobs[0].withdrawalId ?? '',
            attemptsMade: syncFailedJobs[0].attemptsMade,
            failedReason: syncFailedJobs[0].failedReason ?? ''
          }
        : null
    };
  }

  async listWithdrawalAddressPolicies(input?: {
    address?: string;
    policyType?: WithdrawAddressPolicyType;
    limit?: number;
  }) {
    if (!this.withdrawPolicyService) {
      throw new Error('withdraw policy service is not configured');
    }

    return this.withdrawPolicyService.listAddressPolicies(input);
  }

  async upsertWithdrawalAddressPolicy(input: {
    address: string;
    policyType: WithdrawAddressPolicyType;
    reason?: string;
    actorId: string;
  }) {
    if (!this.withdrawPolicyService) {
      throw new Error('withdraw policy service is not configured');
    }

    const policy = await this.withdrawPolicyService.upsertAddressPolicy({
      address: input.address,
      policyType: input.policyType,
      reason: input.reason,
      createdBy: input.actorId
    });

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: `withdraw-policy:${policy.address}:${policy.policyType}`,
      action: 'withdraw.policy.upserted',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        address: policy.address,
        policyType: policy.policyType,
        reason: policy.reason ?? ''
      }
    });

    return policy;
  }

  async deleteWithdrawalAddressPolicy(address: string, policyType: WithdrawAddressPolicyType, actorId: string) {
    if (!this.withdrawPolicyService) {
      throw new Error('withdraw policy service is not configured');
    }

    const deleted = await this.withdrawPolicyService.deleteAddressPolicy(address, policyType);
    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: `withdraw-policy:${address}:${policyType}`,
      action: deleted ? 'withdraw.policy.deleted' : 'withdraw.policy.delete_missed',
      actorType: 'admin',
      actorId,
      metadata: {
        address,
        policyType
      }
    });

    return deleted;
  }

  async listWithdrawalRiskEvents(limit = 50): Promise<{ items: WithdrawalRiskEvent[] }> {
    const logs = await this.ledger.listAuditLogs({
      entityType: 'system',
      limit: Math.max(limit * 4, 100)
    });

    const items = logs
      .filter((log) => log.action === 'withdraw.risk_event.recorded')
      .slice(0, limit)
      .map((log) => ({
        eventId: log.entityId,
        address: log.metadata.address ?? '',
        signal: log.metadata.signal ?? '',
        severity: (log.metadata.severity as WithdrawalRiskEventSeverity | undefined) ?? 'medium',
        reason: log.metadata.reason ?? '',
        createdAt: log.createdAt,
        actorId: log.actorId,
        blacklistPolicyType: (log.metadata.blacklistPolicyType as WithdrawAddressPolicyType | undefined) ?? null
      }));

    return { items };
  }

  async recordWithdrawalRiskEvent(input: {
    address: string;
    signal: string;
    severity: WithdrawalRiskEventSeverity;
    reason: string;
    actorId: string;
    blacklistPolicyType?: WithdrawAddressPolicyType;
  }) {
    if (input.blacklistPolicyType) {
      await this.upsertWithdrawalAddressPolicy({
        address: input.address,
        policyType: input.blacklistPolicyType,
        reason: input.reason,
        actorId: input.actorId
      });
    }

    const eventId = `risk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const log = await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: eventId,
      action: 'withdraw.risk_event.recorded',
      actorType: 'admin',
      actorId: input.actorId,
      metadata: {
        address: input.address,
        signal: input.signal,
        severity: input.severity,
        reason: input.reason,
        blacklistPolicyType: input.blacklistPolicyType ?? ''
      }
    });

    return {
      eventId,
      address: input.address,
      signal: input.signal,
      severity: input.severity,
      reason: input.reason,
      createdAt: log.createdAt,
      actorId: input.actorId,
      blacklistPolicyType: input.blacklistPolicyType ?? null
    } satisfies WithdrawalRiskEvent;
  }

  async getReconciliationReport() {
    const wallets = getConfiguredSystemWallets();
    const [snapshots, ledgerSummary] = await Promise.all([
      this.systemMonitoringService.getStoredWallets(wallets),
      this.ledger.getLedgerSummary()
    ]);

    const onchainTrackedBalance = snapshots
      .filter((snapshot) => snapshot.status === 'ok' && snapshot.tokenBalance)
      .reduce((acc, snapshot) => acc + parseStoredKoriAmount(snapshot.tokenBalance ?? '0'), 0n);

    const hotSnapshot = snapshots.find((snapshot) => snapshot.walletCode === 'hot');
    const hotKori = hotSnapshot?.tokenBalance ? parseStoredKoriAmount(hotSnapshot.tokenBalance) : 0n;
    const hotTrx = hotSnapshot?.trxBalance ? Number(hotSnapshot.trxBalance) : 0;

    const alerts: string[] = [];
    if (hotKori < parseKoriAmount(env.hotWalletAlertMinKori)) {
      alerts.push('HOT_WALLET_KORI_LOW');
    }
    if (hotTrx < env.hotWalletAlertMinTrx) {
      alerts.push('HOT_WALLET_TRX_LOW');
    }

    const gap = onchainTrackedBalance - ledgerSummary.liabilityBalance;

    return {
      ledger: {
        accountCount: ledgerSummary.accountCount,
        availableBalance: formatKoriAmount(ledgerSummary.availableBalance),
        lockedBalance: formatKoriAmount(ledgerSummary.lockedBalance),
        liabilityBalance: formatKoriAmount(ledgerSummary.liabilityBalance),
        confirmedDepositCount: ledgerSummary.confirmedDepositCount,
        activeWithdrawalCount: ledgerSummary.activeWithdrawalCount
      },
      onchain: {
        trackedWalletCount: snapshots.length,
        trackedBalance: formatKoriAmount(onchainTrackedBalance),
        hotWalletBalance: formatKoriAmount(hotKori),
        hotWalletTrx: hotSnapshot?.trxBalance ?? '0'
      },
      gap: {
        amount: formatKoriAmount(gap),
        status: gap >= 0n ? 'covered' : 'deficit'
      },
      alerts
    };
  }

  async planSweeps() {
    const wallets = getConfiguredSystemWallets().filter((wallet) => !['treasury', 'hot'].includes(wallet.code));
    const [snapshots, existingSweeps] = await Promise.all([
      this.systemMonitoringService.getStoredWallets(wallets),
      this.ledger.listSweepRecords(200)
    ]);

    const activeSources = new Set(
      existingSweeps
        .filter((sweep) => ['planned', 'queued', 'broadcasted'].includes(sweep.status))
        .map((sweep) => sweep.sourceWalletCode)
    );
    const minAmount = parseKoriAmount(env.sweepPlanMinKori);
    const sweeps = [];

    for (const snapshot of snapshots) {
      if (snapshot.status !== 'ok' || !snapshot.tokenBalance) {
        continue;
      }

      const amount = parseStoredKoriAmount(snapshot.tokenBalance);
      if (amount < minAmount || activeSources.has(snapshot.walletCode)) {
        continue;
      }

      const sweep = await this.ledger.createSweepRecord({
        sourceWalletCode: snapshot.walletCode,
        sourceAddress: snapshot.address,
        targetAddress: env.hotWalletAddress,
        amount,
        note: 'planned from latest monitoring snapshot'
      });

      await this.ledger.appendAuditLog({
        entityType: 'sweep',
        entityId: sweep.sweepId,
        action: 'sweep.planned',
        actorType: 'system',
        actorId: 'sweep-planner',
        metadata: {
          sourceWalletCode: sweep.sourceWalletCode,
          amount: formatKoriAmount(sweep.amount)
        }
      });

      sweeps.push(sweep);
    }

    return {
      plannedCount: sweeps.length,
      sweeps
    };
  }

  async listSweeps(limit?: number) {
    return this.ledger.listSweepRecords(limit);
  }

  async rebuildLedgerProjections() {
    const result = await this.ledger.rebuildAccountProjections();
    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: 'ledger-projection',
      action: 'ledger.projection.rebuilt',
      actorType: 'system',
      actorId: 'operations-service',
      metadata: {
        accountCount: result.accountCount.toString()
      }
    });
    return result;
  }

  async listFailedWithdrawJobs(limit = 50) {
    return this.withdrawJobQueue.listFailed(limit);
  }

  async retryExternalSyncWithdrawals(withdrawalIds: string[], actorId = 'manual-operator') {
    const uniqueWithdrawalIds = Array.from(new Set(withdrawalIds.map((item) => item.trim()).filter(Boolean)));

    for (const withdrawalId of uniqueWithdrawalIds) {
      await this.withdrawJobQueue.enqueueExternalSync(withdrawalId);
      await this.ledger.appendAuditLog({
        entityType: 'withdrawal',
        entityId: withdrawalId,
        action: 'withdraw.external_sync.retry_requested',
        actorType: 'admin',
        actorId,
        metadata: {}
      });
    }

    return {
      queuedCount: uniqueWithdrawalIds.length,
      withdrawalIds: uniqueWithdrawalIds
    };
  }

  async seedWithdrawalQueueRecovery() {
    const [approved, broadcasted] = await Promise.all([
      this.ledger.listWithdrawalsByStatuses(['ADMIN_APPROVED']),
      this.ledger.listWithdrawalsByStatuses(['TX_BROADCASTED'])
    ]);

    for (const withdrawal of approved) {
      await this.withdrawJobQueue.enqueueDispatch(withdrawal.withdrawalId);
    }
    for (const withdrawal of broadcasted) {
      await this.withdrawJobQueue.enqueueReconcile(withdrawal.withdrawalId);
    }

    await this.ledger.appendAuditLog({
      entityType: 'system',
      entityId: 'withdraw-queue-recovery',
      action: 'withdraw.queue.recovered',
      actorType: 'system',
      actorId: 'operations-service',
      metadata: {
        approvedCount: approved.length.toString(),
        broadcastedCount: broadcasted.length.toString()
      }
    });

    return {
      approvedCount: approved.length,
      broadcastedCount: broadcasted.length
    };
  }

  async markSweepBroadcasted(sweepId: string, txHash: string, note?: string) {
    const sweep = await this.ledger.markSweepBroadcasted(sweepId, txHash, note);
    await this.ledger.appendAuditLog({
      entityType: 'sweep',
      entityId: sweepId,
      action: 'sweep.broadcasted',
      actorType: 'admin',
      actorId: 'manual-operator',
      metadata: {
        txHash,
        note: note ?? ''
      }
    });
    return sweep;
  }

  async confirmSweep(sweepId: string, note?: string) {
    const sweep = await this.ledger.confirmSweep(sweepId, note);
    await this.ledger.appendAuditLog({
      entityType: 'sweep',
      entityId: sweepId,
      action: 'sweep.confirmed',
      actorType: 'admin',
      actorId: 'manual-operator',
      metadata: {
        note: note ?? ''
      }
    });
    return sweep;
  }
}
