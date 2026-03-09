import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoxyaAlertEvent, FoxyaAlertSourceRepository } from '../src/application/ports/foxya-alert-source-repository.js';
import { AlertService } from '../src/application/services/alert-service.js';
import { ExternalAlertMonitorService } from '../src/application/services/external-alert-monitor-service.js';
import { InMemoryAlertMonitorStateRepository } from '../src/infrastructure/persistence/in-memory-alert-monitor-state-repository.js';

describe('external alert monitor service', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('initializes cursor first and then alerts only new foxya events', async () => {
    const sent: Array<{ title: string; body: string }> = [];
    const notifier = {
      sendMessage: vi.fn(async (input: { title: string; body: string }) => {
        sent.push(input);
      })
    };

    const rows: FoxyaAlertEvent[] = [
      {
        table: 'internal_transfers',
        id: 10,
        eventId: 'it-10',
        occurredAt: '2026-03-09T10:00:00.000Z',
        title: '[FOXYA] Internal Transfer COMPLETED',
        lines: ['transferId=it-10', 'amount=50']
      }
    ];

    const source: FoxyaAlertSourceRepository = {
      getMaxId: vi.fn(async () => 10),
      listNewEvents: vi.fn(async (_table, afterId) => rows.filter((row) => row.id > afterId))
    };

    const service = new ExternalAlertMonitorService(
      new InMemoryAlertMonitorStateRepository(),
      new AlertService(notifier as any),
      source,
      {
        enabled: true,
        tables: ['internal_transfers'],
        healthTargets: [],
        eventLimit: 100,
        healthFailureThreshold: 2
      }
    );

    const first = await service.runCycle();
    expect((first as any).initializedCursors).toBe(1);
    expect(sent).toHaveLength(0);

    rows.push({
      table: 'internal_transfers',
      id: 11,
      eventId: 'it-11',
      occurredAt: '2026-03-09T10:01:00.000Z',
      title: '[FOXYA] Internal Transfer PENDING',
      lines: ['transferId=it-11', 'amount=70']
    });

    const second = await service.runCycle();
    expect((second as any).alertedEvents).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toContain('Internal Transfer');
    expect(sent[0].body).toContain('transferId=it-11');
  });

  it('alerts after health threshold and sends recovery on success', async () => {
    const sent: Array<{ title: string; body: string }> = [];
    const notifier = {
      sendMessage: vi.fn(async (input: { title: string; body: string }) => {
        sent.push(input);
      })
    };

    global.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
      .mockResolvedValueOnce(new Response(JSON.stringify({ status: 'UP' }), { status: 200 }));

    const service = new ExternalAlertMonitorService(
      new InMemoryAlertMonitorStateRepository(),
      new AlertService(notifier as any),
      undefined,
      {
        enabled: true,
        tables: [],
        healthTargets: [{ key: 'foxya', name: 'foxya', url: 'https://korion.io.kr/health' }],
        eventLimit: 100,
        healthFailureThreshold: 2
      }
    );

    await service.runCycle();
    expect(sent).toHaveLength(0);

    await service.runCycle();
    expect(sent).toHaveLength(1);
    expect(sent[0].title).toContain('Health Down');

    await service.runCycle();
    expect(sent).toHaveLength(2);
    expect(sent[1].title).toContain('Health Recovered');
  });
});
