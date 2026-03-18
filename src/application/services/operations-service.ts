import { env } from '../../config/env.js';
import { getConfiguredSystemWallets } from '../../config/system-wallets.js';
import { formatKoriAmount, parseKoriAmount, parseStoredKoriAmount } from '../../domain/value-objects/money.js';
import type { WithdrawJobQueue } from '../ports/withdraw-job-queue.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { SystemMonitoringService } from './system-monitoring-service.js';

export class OperationsService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly systemMonitoringService: SystemMonitoringService,
    private readonly withdrawJobQueue: WithdrawJobQueue
  ) {}

  async listAuditLogs(input?: { entityType?: 'withdrawal' | 'sweep' | 'system'; entityId?: string; limit?: number }) {
    return this.ledger.listAuditLogs(input);
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

    return {
      enabled: Boolean(env.foxyaInternalWithdrawalApiUrl && env.foxyaInternalWithdrawalApiKey),
      totalEvents: syncLogs.length,
      successCount: successes.length,
      failureCount: failures.length,
      failedJobCount: syncFailedJobs.length,
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
