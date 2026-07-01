import type { FoxyaBalanceCreditSourceName } from '../ports/foxya-balance-credit-ledger-sync-repository.js';
import { AlertService } from './alert-service.js';
import { FoxyaBalanceCreditLedgerSyncService } from './foxya-balance-credit-ledger-sync-service.js';

export class FoxyaBalanceCreditLedgerSyncWorker {
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly runningSources = new Set<FoxyaBalanceCreditSourceName>();

  constructor(
    private readonly service: FoxyaBalanceCreditLedgerSyncService,
    private readonly alertService: AlertService,
    private readonly intervalMs: number,
    private readonly cycleLimit: number,
    private readonly sourceNames: FoxyaBalanceCreditSourceName[],
    private readonly initialDelayMs: number,
    private readonly sourceGapMs: number
  ) {}

  start() {
    this.sourceNames.forEach((sourceName, index) => {
      const delayMs = this.initialDelayMs + index * this.sourceGapMs;
      const timeout = setTimeout(() => {
        void this.runCycle(sourceName);
        const interval = setInterval(() => {
          void this.runCycle(sourceName);
        }, this.intervalMs);
        this.timers.push(interval);
      }, delayMs);
      this.timers.push(timeout);
    });
  }

  stop() {
    while (this.timers.length > 0) {
      const timer = this.timers.pop();
      if (timer) {
        clearTimeout(timer);
        clearInterval(timer);
      }
    }
    this.runningSources.clear();
  }

  async runCycle(sourceName: FoxyaBalanceCreditSourceName) {
    if (this.runningSources.has(sourceName)) {
      console.warn('FoxyaBalanceCreditLedgerSyncWorker cycle skipped: previous source cycle still running', {
        sourceName
      });
      return;
    }

    this.runningSources.add(sourceName);
    try {
      const result = await this.service.runCycle(sourceName, this.cycleLimit);
      console.info('FoxyaBalanceCreditLedgerSyncWorker cycle completed', result);
      if (result.failedCount > 0) {
        await this.alertService.notifyFoxyaTokenDepositLedgerSyncFailure(
          `source=${sourceName}, failedCount=${result.failedCount}, checkedCount=${result.checkedCount}`
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'foxya balance credit ledger sync cycle failed';
      console.error('FoxyaBalanceCreditLedgerSyncWorker cycle failed:', { sourceName, error });
      await this.alertService.notifyFoxyaTokenDepositLedgerSyncFailure(`source=${sourceName}, ${message}`);
    } finally {
      this.runningSources.delete(sourceName);
    }
  }
}
