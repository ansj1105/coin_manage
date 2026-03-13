import { ActivationReclaimService } from './activation-reclaim-service.js';
import { AlertService } from './alert-service.js';

export class ActivationReclaimWorker {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly activationReclaimService: ActivationReclaimService,
    private readonly alertService: AlertService,
    private readonly intervalMs: number
  ) {}

  start() {
    if (this.timer) {
      return;
    }

    const run = async () => {
      try {
        await this.activationReclaimService.runCycle();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'activation reclaim worker failed';
        await this.alertService.notifyActivationReclaimFailure({
          userId: '-',
          walletAddress: '-',
          message
        });
      }
    };

    void run();
    this.timer = setInterval(() => {
      void run();
    }, this.intervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }
}
