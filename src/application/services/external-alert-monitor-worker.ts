import { ExternalAlertMonitorService } from './external-alert-monitor-service.js';

export class ExternalAlertMonitorWorker {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly service: ExternalAlertMonitorService,
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

  private async runCycle() {
    try {
      await this.service.runCycle();
    } catch (error) {
      console.error('ExternalAlertMonitorWorker cycle failed:', error);
    }
  }
}
