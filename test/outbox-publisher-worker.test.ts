import { describe, expect, it, vi } from 'vitest';
import { createAppDependencies } from '../src/container/create-app-dependencies.js';
import { OutboxPublisherWorker } from '../src/application/services/outbox-publisher-worker.js';
import { InMemoryLedgerRepository } from '../src/infrastructure/persistence/in-memory-ledger-repository.js';
import { InMemoryEventPublisher } from '../src/infrastructure/events/in-memory-event-publisher.js';
import { MockTronGateway } from '../src/infrastructure/blockchain/mock-tron-gateway.js';

const TRACKED_DEPOSIT_ADDRESS = 'TSM7ocJQHigW9jhk5yFQKrUmBAXz2FFapa';

describe('outbox publisher worker', () => {
  it('publishes deposit and withdrawal state events from durable outbox records', async () => {
    const deps = createAppDependencies({
      tronGateway: new MockTronGateway()
    });
    const publishSpy = vi.spyOn(deps.eventPublisher, 'publish');

    await deps.walletService.bindWalletAddress({
      userId: 'user-1',
      walletAddress: 'TBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
    });

    await deps.depositService.processDeposit({
      userId: 'user-1',
      txHash: `outbox-deposit-${Date.now()}`,
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      amountKori: 10,
      blockNumber: 1
    });
    const request = await deps.withdrawService.request({
      userId: 'user-1',
      amountKori: 1,
      toAddress: 'TAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
      idempotencyKey: 'outbox-withdraw-1',
      clientIp: '127.0.0.1',
      deviceId: 'device-1'
    });

    expect(publishSpy).not.toHaveBeenCalledWith('deposit.state.changed', expect.anything());
    expect(publishSpy).not.toHaveBeenCalledWith('withdrawal.state.changed', expect.anything());

    await deps.outboxPublisherWorker.runCycle();

    expect(publishSpy).toHaveBeenCalledWith('deposit.state.changed', expect.objectContaining({
      depositId: expect.any(String)
    }));
    expect(publishSpy).toHaveBeenCalledWith('withdrawal.state.changed', expect.objectContaining({
      withdrawalId: request.withdrawal.withdrawalId
    }));
  });

  it('reschedules failed publishes and retries them on the next cycle', async () => {
    const ledger = new InMemoryLedgerRepository({
      singleLimit: 1_000_000_000n,
      dailyLimit: 10_000_000_000n
    });
    await ledger.applyDeposit({
      userId: 'user-1',
      amount: 1_000_000n,
      txHash: 'retry-tx-1',
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      walletAddress: TRACKED_DEPOSIT_ADDRESS,
      blockNumber: 1
    });

    const publisher = new InMemoryEventPublisher();
    const publishSpy = vi
      .spyOn(publisher, 'publish')
      .mockImplementationOnce(() => {
        throw new Error('temporary publish failure');
      })
      .mockImplementation(() => undefined);

    const worker = new OutboxPublisherWorker(ledger, publisher, {
      intervalMs: 1_000,
      batchSize: 10,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      maxAttempts: 5
    });

    await worker.runCycle();
    const pendingAfterFailure = await ledger.claimPendingOutboxEvents(10);
    expect(pendingAfterFailure).toHaveLength(1);

    await ledger.rescheduleOutboxEvent(pendingAfterFailure[0]!.outboxEventId, '', new Date(0).toISOString());
    await worker.runCycle();

    expect(publishSpy).toHaveBeenCalledTimes(2);
    const remaining = await ledger.claimPendingOutboxEvents(10);
    expect(remaining).toHaveLength(0);
  });

  it('dead-letters events after max attempts', async () => {
    const ledger = new InMemoryLedgerRepository({
      singleLimit: 1_000_000_000n,
      dailyLimit: 10_000_000_000n
    });
    await ledger.applyDeposit({
      userId: 'user-1',
      amount: 1_000_000n,
      txHash: 'dead-letter-tx-1',
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      walletAddress: TRACKED_DEPOSIT_ADDRESS,
      blockNumber: 1
    });

    const publisher = new InMemoryEventPublisher();
    vi.spyOn(publisher, 'publish').mockImplementation(() => {
      throw new Error('permanent publish failure');
    });

    const worker = new OutboxPublisherWorker(ledger, publisher, {
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      maxAttempts: 1
    });

    await worker.runCycle();

    const events = await ledger.listOutboxEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      status: 'dead_lettered',
      attempts: 1,
      lastError: 'permanent publish failure'
    });
  });

  it('recovers stale processing events before claiming new work', async () => {
    const ledger = new InMemoryLedgerRepository({
      singleLimit: 1_000_000_000n,
      dailyLimit: 10_000_000_000n
    });
    await ledger.applyDeposit({
      userId: 'user-1',
      amount: 1_000_000n,
      txHash: 'stale-processing-tx-1',
      toAddress: TRACKED_DEPOSIT_ADDRESS,
      walletAddress: TRACKED_DEPOSIT_ADDRESS,
      blockNumber: 1,
      nowIso: '2026-03-19T00:00:00.000Z'
    });
    await ledger.claimPendingOutboxEvents(10, '2026-03-19T00:00:01.000Z');

    const worker = new OutboxPublisherWorker(ledger, new InMemoryEventPublisher(), {
      maxAttempts: 5
    });
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-03-19T00:10:00.000Z'));

    await worker.runCycle();

    vi.restoreAllMocks();
    const events = await ledger.listOutboxEvents();
    expect(events[0]).toMatchObject({
      status: 'published'
    });
  });
});
