import { AlertService } from './alert-service.js';
import { ResourceDelegationService } from './resource-delegation-service.js';

export class ResourceDelegationWorker {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly resourceDelegationService: ResourceDelegationService,
    private readonly alertService: AlertService,
    private readonly intervalMs: number
  ) {}

  start() {
    if (this.timer) {
      return;
    }

    const run = async () => {
      try {
        await this.resourceDelegationService.runCycle();
      } catch (error) {
        const message = error instanceof Error ? error.message : 'resource delegation worker failed';
        await this.alertService.notifyResourceDelegationFailure({
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
