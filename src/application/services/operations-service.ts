import { env } from '../../config/env.js';
import { getConfiguredSystemWallets } from '../../config/system-wallets.js';
import { formatKoriAmount, parseKoriAmount, parseStoredKoriAmount } from '../../domain/value-objects/money.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { SystemMonitoringService } from './system-monitoring-service.js';

export class OperationsService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly systemMonitoringService: SystemMonitoringService
  ) {}

  async listAuditLogs(input?: { entityType?: 'withdrawal' | 'sweep' | 'system'; entityId?: string; limit?: number }) {
    return this.ledger.listAuditLogs(input);
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
        .filter((sweep) => ['planned', 'broadcasted'].includes(sweep.status))
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
