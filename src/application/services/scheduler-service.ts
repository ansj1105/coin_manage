import type { EventPublisher } from '../ports/event-publisher.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { WithdrawService } from './withdraw-service.js';

export class SchedulerService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly withdrawService: WithdrawService,
    private readonly eventPublisher: EventPublisher
  ) {}

  async processWithdrawQueue() {
    const pending = await this.ledger.listPendingApprovalWithdrawals();
    let autoApproved = 0;
    let reviewQueued = 0;

    for (const withdrawal of pending) {
      if (withdrawal.riskLevel === 'low' && withdrawal.requiredApprovals <= 1) {
        await this.withdrawService.approve(withdrawal.withdrawalId, {
          adminId: 'system-queue',
          actorType: 'system',
          note: 'auto-approved low-risk withdrawal'
        });
        autoApproved += 1;
        continue;
      }

      if (withdrawal.status === 'PENDING_ADMIN') {
        await this.ledger.markWithdrawalReviewRequired(withdrawal.withdrawalId, 'manual review required');
        await this.ledger.enqueueJob('withdraw_manual_review', {
          withdrawalId: withdrawal.withdrawalId,
          riskLevel: withdrawal.riskLevel
        });
        await this.ledger.appendAuditLog({
          entityType: 'withdrawal',
          entityId: withdrawal.withdrawalId,
          action: 'withdraw.review_required',
          actorType: 'system',
          actorId: 'scheduler',
          metadata: {
            riskLevel: withdrawal.riskLevel,
            requiredApprovals: withdrawal.requiredApprovals.toString()
          }
        });
        reviewQueued += 1;
      }
    }

    this.eventPublisher.publish('scheduler.withdraw.queue.processed', {
      pendingCount: pending.length,
      autoApproved,
      reviewQueued
    });

    return {
      pendingCount: pending.length,
      autoApproved,
      reviewQueued
    };
  }

  async retryPending(timeoutSec: number) {
    const stuck = await this.ledger.listStuckWithdrawals(timeoutSec);

    for (const withdrawal of stuck) {
      if (withdrawal.status === 'TX_BROADCASTED') {
        continue;
      }
      await this.ledger.enqueueJob('withdraw_manual_review', {
        withdrawalId: withdrawal.withdrawalId,
        status: withdrawal.status
      });
    }

    const reconcile = await this.withdrawService.reconcileBroadcasted();

    this.eventPublisher.publish('scheduler.pending.retried', {
      stuckCount: stuck.length,
      reconcile
    });

    return {
      stuckCount: stuck.length,
      queuedManualReview: stuck.filter((item) => item.status !== 'TX_BROADCASTED').length,
      reconcile
    };
  }
}
