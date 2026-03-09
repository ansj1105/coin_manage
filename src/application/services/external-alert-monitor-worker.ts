import { ExternalAlertMonitorService } from './external-alert-monitor-service.js';

export class ExternalAlertMonitorWorker {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly service: ExternalAlertMonitorService,
    private readonly intervalMs: number
  ) {}

  start() {
    void this.service.runCycle();
    this.timer = setInterval(() => {
      void this.service.runCycle();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
