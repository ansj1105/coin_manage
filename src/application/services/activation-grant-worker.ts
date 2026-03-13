import { AlertService } from './alert-service.js';
import { ActivationGrantService } from './activation-grant-service.js';

export class ActivationGrantWorker {
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly activationGrantService: ActivationGrantService,
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
      await this.activationGrantService.runCycle();
    } catch (error) {
      await this.alertService.notifyActivationGrantFailure({
        userId: 'cycle',
        walletAddress: 'activation-grant',
        message: error instanceof Error ? error.message : 'activation grant cycle failed'
      });
    }
  }
}
