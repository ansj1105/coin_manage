import { Queue, Worker, type JobsOptions } from 'bullmq';
import type { WithdrawJobQueue } from '../../application/ports/withdraw-job-queue.js';

type BullmqOptions = {
  connection: {
    url: string;
  };
  queueName: string;
  dispatchAttempts: number;
  reconcileAttempts: number;
  backoffDelayMs: number;
};

export class BullmqWithdrawJobQueue implements WithdrawJobQueue {
  private readonly queue: Queue;
  private worker?: Worker;
  private readonly connection: { host: string; port: number; username?: string; password?: string; db?: number };

  constructor(
    private readonly handlers: {
      dispatch: (withdrawalId: string, attempt: number) => Promise<void>;
      reconcile: (withdrawalId: string | undefined, attempt: number) => Promise<void>;
    },
    private readonly options: BullmqOptions
  ) {
    const parsed = new URL(options.connection.url);
    this.connection = {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      db: parsed.pathname && parsed.pathname !== '/' ? Number(parsed.pathname.slice(1)) : undefined
    };
    this.queue = new Queue(options.queueName, {
      connection: this.connection
    });
  }

  async enqueueDispatch(withdrawalId: string): Promise<void> {
    await this.queue.add(
      'dispatch',
      { withdrawalId },
      this.buildOptions(`dispatch:${withdrawalId}`, this.options.dispatchAttempts)
    );
  }

  async enqueueReconcile(withdrawalId?: string): Promise<void> {
    await this.queue.add(
      'reconcile',
      { withdrawalId },
      this.buildOptions(`reconcile:${withdrawalId ?? '*'}`, this.options.reconcileAttempts)
    );
  }

  async listFailed(limit: number) {
    const jobs = await this.queue.getJobs(['failed'], 0, Math.max(0, limit - 1), false);
    return jobs.map((job) => ({
      id: job.id ?? `${job.name}:${job.data.withdrawalId ?? '*'}`,
      name: job.name as 'dispatch' | 'reconcile',
      withdrawalId: job.data.withdrawalId ? String(job.data.withdrawalId) : undefined,
      failedReason: job.failedReason,
      attemptsMade: job.attemptsMade
    }));
  }

  start(): void {
    if (this.worker) {
      return;
    }

    this.worker = new Worker(
      this.options.queueName,
      async (job) => {
        if (job.name === 'dispatch') {
          await this.handlers.dispatch(String(job.data.withdrawalId), job.attemptsStarted);
          return;
        }
        await this.handlers.reconcile(job.data.withdrawalId ? String(job.data.withdrawalId) : undefined, job.attemptsStarted);
      },
      {
        connection: this.connection,
        concurrency: 5
      }
    );
  }

  async stop(): Promise<void> {
    await this.worker?.close();
    this.worker = undefined;
    await this.queue.close();
  }

  private buildOptions(jobId: string, attempts: number): JobsOptions {
    return {
      jobId,
      removeOnComplete: 1000,
      removeOnFail: 1000,
      attempts,
      backoff: {
        type: 'exponential',
        delay: this.options.backoffDelayMs
      }
    };
  }
}
