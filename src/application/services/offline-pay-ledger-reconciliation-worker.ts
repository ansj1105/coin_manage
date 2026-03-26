import { OfflinePayLedgerReconciliationService } from './offline-pay-ledger-reconciliation-service.js';

export class OfflinePayLedgerReconciliationWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly service: OfflinePayLedgerReconciliationService,
    private readonly intervalMs: number,
    private readonly cycleLimit: number
  ) {}

  start() {
    void this.runCycle();
    this.timer = setInterval(() => {
      void this.runCycle();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async runCycle() {
    if (this.running) {
      console.warn('OfflinePayLedgerReconciliationWorker cycle skipped: previous cycle still running');
      return;
    }

    this.running = true;
    try {
      const result = await this.service.runCycle(this.cycleLimit);
      console.info('OfflinePayLedgerReconciliationWorker cycle completed', {
        checkedCount: result.checkedCount,
        adjustedCount: result.adjustedCount,
        skippedCount: result.skippedCount,
        failedCount: result.failedCount,
      });
    } catch (error) {
      console.error('OfflinePayLedgerReconciliationWorker cycle failed:', error);
    } finally {
      this.running = false;
    }
  }
}
