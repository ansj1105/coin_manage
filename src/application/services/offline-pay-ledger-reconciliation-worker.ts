import { OfflinePayLedgerReconciliationService } from './offline-pay-ledger-reconciliation-service.js';

export class OfflinePayLedgerReconciliationWorker {
  private timer?: ReturnType<typeof setInterval>;

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
    try {
      await this.service.runCycle(this.cycleLimit);
    } catch (error) {
      console.error('OfflinePayLedgerReconciliationWorker cycle failed:', error);
    }
  }
}
