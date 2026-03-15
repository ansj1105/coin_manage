import type { WithdrawJobQueue } from '../../application/ports/withdraw-job-queue.js';

type InMemoryJob =
  | { kind: 'dispatch'; withdrawalId: string; attempt: number }
  | { kind: 'reconcile'; withdrawalId?: string; attempt: number };

type FailedJob = {
  id: string;
  name: 'dispatch' | 'reconcile';
  withdrawalId?: string;
  failedReason?: string;
  attemptsMade: number;
};

export class InMemoryWithdrawJobQueue implements WithdrawJobQueue {
  private readonly jobs: InMemoryJob[] = [];
  private readonly failedJobs: FailedJob[] = [];
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly handlers: {
      dispatch: (withdrawalId: string, attempt: number) => Promise<void>;
      reconcile: (withdrawalId: string | undefined, attempt: number) => Promise<void>;
    },
    private readonly intervalMs = 50
  ) {}

  async enqueueDispatch(withdrawalId: string): Promise<void> {
    this.jobs.push({ kind: 'dispatch', withdrawalId, attempt: 1 });
  }

  async enqueueReconcile(withdrawalId?: string): Promise<void> {
    this.jobs.push({ kind: 'reconcile', withdrawalId, attempt: 1 });
  }

  async listFailed(limit: number) {
    return this.failedJobs.slice(0, limit);
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      void this.drain();
    }, this.intervalMs);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async drain(): Promise<void> {
    while (this.jobs.length > 0) {
      const job = this.jobs.shift();
      if (!job) {
        return;
      }
      if (job.kind === 'dispatch') {
        try {
          await this.handlers.dispatch(job.withdrawalId, job.attempt);
        } catch (error) {
          this.failedJobs.unshift({
            id: `dispatch:${job.withdrawalId}:${Date.now()}`,
            name: 'dispatch',
            withdrawalId: job.withdrawalId,
            failedReason: error instanceof Error ? error.message : 'dispatch failed',
            attemptsMade: job.attempt
          });
          throw error;
        }
      } else {
        try {
          await this.handlers.reconcile(job.withdrawalId, job.attempt);
        } catch (error) {
          this.failedJobs.unshift({
            id: `reconcile:${job.withdrawalId ?? '*'}:${Date.now()}`,
            name: 'reconcile',
            withdrawalId: job.withdrawalId,
            failedReason: error instanceof Error ? error.message : 'reconcile failed',
            attemptsMade: job.attempt
          });
          throw error;
        }
      }
    }
  }
}
