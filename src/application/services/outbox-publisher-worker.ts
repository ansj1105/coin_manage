import type { EventPublisher } from '../ports/event-publisher.js';
import type { LedgerRepository } from '../ports/ledger-repository.js';
import { env } from '../../config/env.js';

export class OutboxPublisherWorker {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly ledger: LedgerRepository,
    private readonly eventPublisher: EventPublisher,
    private readonly options: {
      intervalMs?: number;
      batchSize?: number;
      retryBaseDelayMs?: number;
      retryMaxDelayMs?: number;
      maxAttempts?: number;
    } = {}
  ) {}

  private get intervalMs() {
    return this.options.intervalMs ?? 5_000;
  }

  private get batchSize() {
    return this.options.batchSize ?? 100;
  }

  private get retryBaseDelayMs() {
    return this.options.retryBaseDelayMs ?? 30_000;
  }

  private get retryMaxDelayMs() {
    return this.options.retryMaxDelayMs ?? 300_000;
  }

  private get maxAttempts() {
    return this.options.maxAttempts ?? 10;
  }

  private get processingStaleTimeoutSec() {
    return env.outboxProcessingStaleTimeoutSec;
  }

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
      return;
    }

    this.running = true;
    try {
      await this.ledger.recoverStaleProcessingOutboxEvents(this.processingStaleTimeoutSec);
      const events = await this.ledger.claimPendingOutboxEvents(this.batchSize);
      for (const event of events) {
        try {
          this.eventPublisher.publish(event.eventType, event.payload);
          await this.ledger.markOutboxEventPublished(event.outboxEventId);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'outbox publish failed';
          if (event.attempts >= this.maxAttempts) {
            await this.ledger.deadLetterOutboxEvent(event.outboxEventId, message);
            continue;
          }

          const retryDelayMs = Math.min(
            this.retryMaxDelayMs,
            this.retryBaseDelayMs * 2 ** Math.max(event.attempts - 1, 0)
          );
          const nextAvailableAt = new Date(Date.now() + retryDelayMs).toISOString();
          await this.ledger.rescheduleOutboxEvent(event.outboxEventId, message, nextAvailableAt);
        }
      }
    } catch (error) {
      console.error('outbox publisher cycle failed', error);
    } finally {
      this.running = false;
    }
  }
}
