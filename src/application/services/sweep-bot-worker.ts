import { AlertService } from './alert-service.js';
import { SweepBotService } from './sweep-bot-service.js';

export class SweepBotWorker {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly sweepBotService: SweepBotService,
    private readonly alertService: AlertService,
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
    try {
      await this.sweepBotService.runCycle();
    } catch (error) {
      await this.alertService.notifySweepFailure({
        depositId: 'cycle',
        sourceAddress: 'sweep-bot',
        message: error instanceof Error ? error.message : 'sweep bot cycle failed'
      });
    }
  }
}
