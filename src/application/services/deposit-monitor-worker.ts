import { DepositMonitorService } from './deposit-monitor-service.js';

export class DepositMonitorWorker {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly depositMonitorService: DepositMonitorService,
    private readonly intervalMs: number
  ) {}

  start() {
    void this.depositMonitorService.runCycle();
    this.timer = setInterval(() => {
      void this.depositMonitorService.runCycle();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
