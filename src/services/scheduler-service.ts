import { EventBus } from '../events/event-bus.js';
import { InMemoryLedger } from '../ledger/in-memory-ledger.js';
import { WithdrawService } from './withdraw-service.js';

export class SchedulerService {
  constructor(
    private readonly ledger: InMemoryLedger,
    private readonly withdrawService: WithdrawService,
    private readonly eventBus: EventBus
  ) {}

  async retryPending(timeoutSec: number) {
    const stuck = await this.ledger.listStuckWithdrawals(timeoutSec);

    for (const withdrawal of stuck) {
      if (withdrawal.status === 'broadcasted') {
        continue;
      }
      await this.ledger.enqueueJob('withdraw_manual_review', {
        withdrawalId: withdrawal.withdrawalId,
        status: withdrawal.status
      });
    }

    const reconcile = await this.withdrawService.reconcileBroadcasted();

    this.eventBus.publish('scheduler.pending.retried', {
      stuckCount: stuck.length,
      reconcile
    });

    return {
      stuckCount: stuck.length,
      queuedManualReview: stuck.filter((item) => item.status !== 'broadcasted').length,
      reconcile
    };
  }
}
