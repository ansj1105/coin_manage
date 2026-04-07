import { formatKoriAmount, parseStoredKoriAmount } from '../../domain/value-objects/money.js';
import type { EventPublisher } from '../ports/event-publisher.js';
import type { FoxyaWalletRepository } from '../ports/foxya-wallet-repository.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { OperationsService } from './operations-service.js';

type ReconciliationOptions = {
  currencyCode: string;
  toleranceAmount: bigint;
  maxAdjustmentAmount: bigint;
};

export class OfflinePayLedgerReconciliationService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly operationsService: OperationsService,
    private readonly foxyaWalletRepository: FoxyaWalletRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly options: ReconciliationOptions
  ) {}

  async runCycle(limit: number) {
    const [existingLedgerUserIds, bootstrapCandidates] = await Promise.all([
      this.ledger.listOfflinePayReconciliationUserIds(limit),
      this.foxyaWalletRepository.listUserIdsWithPositiveCanonicalBalance({
        currencyCode: this.options.currencyCode,
        limit: Math.max(limit * 5, limit)
      })
    ]);
    const existingLedgerUserIdSet = new Set(existingLedgerUserIds);
    const bootstrapUserIds: string[] = [];

    for (const userId of bootstrapCandidates) {
      if (existingLedgerUserIdSet.has(userId)) {
        continue;
      }
      const hasFootprint = await this.ledger.hasOfflinePayLedgerFootprint(userId);
      if (hasFootprint) {
        continue;
      }
      bootstrapUserIds.push(userId);
      if (bootstrapUserIds.length >= limit) {
        break;
      }
    }

    const userIds = [...bootstrapUserIds, ...existingLedgerUserIds].slice(0, limit);
    let checkedCount = 0;
    let adjustedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    for (const userId of userIds) {
      try {
        checkedCount += 1;
        const snapshot = await this.foxyaWalletRepository.getCanonicalWalletSnapshot({
          userId,
          currencyCode: this.options.currencyCode
        });
        const current = await this.ledger.getOfflinePayUserBalanceSnapshot(userId);
        const targetLiabilityBalance = parseStoredKoriAmount(snapshot.totalBalance);
        const deltaAmount = targetLiabilityBalance - current.liabilityBalance;
        const absoluteDelta = deltaAmount < 0n ? -deltaAmount : deltaAmount;

        if (absoluteDelta <= this.options.toleranceAmount) {
          skippedCount += 1;
          continue;
        }

        if (absoluteDelta > this.options.maxAdjustmentAmount) {
          failedCount += 1;
          await this.ledger.appendAuditLog({
            entityType: 'system',
            entityId: `offline-pay-reconciliation:${userId}`,
            action: 'offline_pay.user_balance.reconcile.skipped',
            actorType: 'system',
            actorId: 'offline-pay-ledger-reconcile-worker',
            metadata: {
              userId,
              reason: 'delta_exceeds_max_adjustment',
              canonicalBasis: snapshot.canonicalBasis,
              currentLiabilityBalance: formatKoriAmount(current.liabilityBalance),
              targetLiabilityBalance: snapshot.totalBalance,
              deltaAmount: formatKoriAmount(deltaAmount),
              maxAdjustmentAmount: formatKoriAmount(this.options.maxAdjustmentAmount)
            }
          });
          this.eventPublisher.publish('offline_pay.ledger_reconciliation.skipped', {
            userId,
            reason: 'delta_exceeds_max_adjustment',
            canonicalBasis: snapshot.canonicalBasis,
            deltaAmount: formatKoriAmount(deltaAmount)
          });
          continue;
        }

        const result = await this.operationsService.reconcileOfflinePayUserBalance({
          userId,
          targetLiabilityBalance: snapshot.totalBalance,
          canonicalBasis: snapshot.canonicalBasis,
          actorId: 'offline-pay-ledger-reconcile-worker',
          note: `auto reconcile from ${snapshot.canonicalBasis}`
        });

        if (result.adjusted) {
          adjustedCount += 1;
          await this.ledger.appendAuditLog({
            entityType: 'system',
            entityId: `offline-pay-reconciliation:${userId}`,
            action: 'offline_pay.user_balance.reconciled',
            actorType: 'system',
            actorId: 'offline-pay-ledger-reconcile-worker',
            metadata: {
              userId,
              canonicalBasis: snapshot.canonicalBasis,
              previousLiabilityBalance: result.previousLiabilityBalance,
              targetLiabilityBalance: result.targetLiabilityBalance,
              deltaAmount: result.deltaAmount,
              adjusted: 'true',
              accountingSide: 'SENDER',
              receiverSettlementMode: 'EXTERNAL_HISTORY_SYNC',
              settlementModel: 'SENDER_LEDGER_PLUS_RECEIVER_HISTORY',
              reconciliationTrackingOwner: 'OFFLINE_PAY_SAGA',
              note: `auto reconcile from ${snapshot.canonicalBasis}`
            }
          });
          this.eventPublisher.publish('offline_pay.ledger_reconciliation.adjusted', {
            userId,
            canonicalBasis: snapshot.canonicalBasis,
            previousLiabilityBalance: result.previousLiabilityBalance,
            targetLiabilityBalance: result.targetLiabilityBalance,
            deltaAmount: result.deltaAmount
          });
        } else {
          skippedCount += 1;
        }
      } catch (error) {
        failedCount += 1;
        const message = error instanceof Error ? error.message : 'offline pay ledger reconciliation failed';
        await this.ledger.appendAuditLog({
          entityType: 'system',
          entityId: `offline-pay-reconciliation:${userId}`,
          action: 'offline_pay.user_balance.reconcile.failed',
          actorType: 'system',
          actorId: 'offline-pay-ledger-reconcile-worker',
          metadata: {
            userId,
            error: message
          }
        });
        this.eventPublisher.publish('offline_pay.ledger_reconciliation.failed', {
          userId,
          error: message
        });
      }
    }

    return {
      checkedCount,
      adjustedCount,
      skippedCount,
      failedCount
    };
  }
}
