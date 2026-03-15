import type { EventPublisher } from '../ports/event-publisher.js';
import type { WithdrawJobQueue } from '../ports/withdraw-job-queue.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { WithdrawService } from './withdraw-service.js';

export class SchedulerService {
  constructor(
    private readonly ledger: LedgerRepository,
    private readonly withdrawService: WithdrawService,
    private readonly eventPublisher: EventPublisher,
    private readonly withdrawJobQueue: WithdrawJobQueue
  ) {}

  async processWithdrawQueue() {
    const pending = await this.ledger.listPendingApprovalWithdrawals();
    let reviewQueued = 0;

    for (const withdrawal of pending) {
      if (withdrawal.status === 'PENDING_ADMIN' && !withdrawal.reviewRequiredAt) {
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
      reviewQueued
    });

    return {
      pendingCount: pending.length,
      autoApproved: 0,
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

    await this.withdrawJobQueue.enqueueReconcile();
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
