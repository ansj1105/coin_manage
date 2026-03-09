import { AlertService } from './alert-service.js';
import { OperationsService } from './operations-service.js';

export class AlertWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly alertService: AlertService,
    private readonly operationsService: OperationsService,
    private readonly intervalMs: number
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
    if (this.running || !this.alertService.enabled) {
      return;
    }

    this.running = true;
    try {
      const report = await this.operationsService.getReconciliationReport();
      await this.alertService.notifyReconciliationAlerts({
        alerts: report.alerts,
        hotWalletBalance: String(report.onchain.hotWalletBalance),
        hotWalletTrx: String(report.onchain.hotWalletTrx)
      });
    } catch (error) {
      console.error('alert cycle failed', error);
    } finally {
      this.running = false;
    }
  }
}
