import { AlertService } from './alert-service.js';
import { FoxyaTokenDepositLedgerSyncService } from './foxya-token-deposit-ledger-sync-service.js';

export class FoxyaTokenDepositLedgerSyncWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly service: FoxyaTokenDepositLedgerSyncService,
    private readonly alertService: AlertService,
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
      console.warn('FoxyaTokenDepositLedgerSyncWorker cycle skipped: previous cycle still running');
      return;
    }

    this.running = true;
    try {
      const result = await this.service.runCycle(this.cycleLimit);
      console.info('FoxyaTokenDepositLedgerSyncWorker cycle completed', result);
      if (result.failedCount > 0) {
        await this.alertService.notifyFoxyaTokenDepositLedgerSyncFailure(
          `failedCount=${result.failedCount}, checkedCount=${result.checkedCount}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'foxya token deposit ledger sync cycle failed';
      console.error('FoxyaTokenDepositLedgerSyncWorker cycle failed:', error);
      await this.alertService.notifyFoxyaTokenDepositLedgerSyncFailure(message);
    } finally {
      this.running = false;
    }
  }
}
