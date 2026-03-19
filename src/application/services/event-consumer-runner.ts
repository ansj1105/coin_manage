import { createHash } from 'node:crypto';
import type { LedgerRepository } from '../ports/ledger-repository.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class EventConsumerRunner {
  constructor(private readonly ledger: LedgerRepository) {}

  async run<TPayload extends Record<string, unknown>>(
    input: {
      consumerName: string;
      eventType: string;
      payload: TPayload;
      aggregateId?: string;
      maxAttempts: number;
      retryBaseDelayMs: number;
      retryMaxDelayMs: number;
    },
    handler: () => Promise<void>,
    onDeadLetter?: () => Promise<void>
  ) {
    const eventKey = this.buildEventKey(input.eventType, input.payload);
    if (await this.ledger.hasSucceededEventConsumerCheckpoint({ consumerName: input.consumerName, eventKey })) {
      return;
    }

    for (let attemptNumber = 1; attemptNumber <= input.maxAttempts; attemptNumber += 1) {
      const startedAt = Date.now();
      try {
        await handler();
        await this.ledger.appendEventConsumerAttempt({
          eventKey,
          eventType: input.eventType,
          consumerName: input.consumerName,
          status: 'succeeded',
          attemptNumber,
          aggregateId: input.aggregateId,
          durationMs: Date.now() - startedAt
        });
        await this.ledger.upsertEventConsumerCheckpoint({
          consumerName: input.consumerName,
          eventKey,
          eventType: input.eventType,
          aggregateId: input.aggregateId,
          lastStatus: 'succeeded'
        });
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'unknown consumer failure';
        await this.ledger.appendEventConsumerAttempt({
          eventKey,
          eventType: input.eventType,
          consumerName: input.consumerName,
          status: 'failed',
          attemptNumber,
          aggregateId: input.aggregateId,
          errorMessage: message.slice(0, 1000),
          durationMs: Date.now() - startedAt
        });

        if (attemptNumber >= input.maxAttempts) {
          await this.ledger.appendEventConsumerDeadLetter({
            eventKey,
            eventType: input.eventType,
            consumerName: input.consumerName,
            aggregateId: input.aggregateId,
            payload: input.payload,
            errorMessage: message.slice(0, 1000)
          });
          await this.ledger.upsertEventConsumerCheckpoint({
            consumerName: input.consumerName,
            eventKey,
            eventType: input.eventType,
            aggregateId: input.aggregateId,
            lastStatus: 'dead_lettered'
          });
          await onDeadLetter?.();
          return;
        }

        const delayMs = Math.min(input.retryMaxDelayMs, input.retryBaseDelayMs * 2 ** (attemptNumber - 1));
        if (delayMs > 0) {
          await sleep(delayMs);
        }
      }
    }
  }

  private buildEventKey(eventType: string, payload: Record<string, unknown>) {
    const stable = JSON.stringify(payload, Object.keys(payload).sort());
    return createHash('sha256').update(`${eventType}:${stable}`).digest('hex');
  }
}
