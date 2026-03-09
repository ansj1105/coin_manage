import { randomUUID } from 'node:crypto';
import type { DepositMonitorRepository } from '../../application/ports/deposit-monitor-repository.js';
import type {
  DepositMonitorCursor,
  ExternalDepositEvent,
  ExternalDepositEventStatus
} from '../../domain/deposit-monitor/types.js';

const EVENT_STATUS_VALUES: ExternalDepositEventStatus[] = ['discovered', 'registered', 'completed'];

export class InMemoryDepositMonitorRepository implements DepositMonitorRepository {
  private readonly cursors = new Map<string, DepositMonitorCursor>();
  private readonly events = new Map<string, ExternalDepositEvent>();

  async getCursor(scannerKey: string): Promise<DepositMonitorCursor | undefined> {
    return this.cursors.get(scannerKey);
  }

  async saveCursor(input: Omit<DepositMonitorCursor, 'updatedAt'> & { updatedAt?: string }): Promise<DepositMonitorCursor> {
    const cursor: DepositMonitorCursor = {
      ...input,
      updatedAt: input.updatedAt ?? new Date().toISOString()
    };
    this.cursors.set(input.scannerKey, cursor);
    return cursor;
  }

  async recordDiscoveredEvent(
    input: Omit<ExternalDepositEvent, 'createdAt' | 'updatedAt'> & { createdAt?: string }
  ): Promise<ExternalDepositEvent> {
    const existing = this.events.get(input.eventKey);
    if (existing) {
      return existing;
    }

    const createdAt = input.createdAt ?? new Date().toISOString();
    const event: ExternalDepositEvent = {
      ...input,
      createdAt,
      updatedAt: createdAt
    };
    this.events.set(event.eventKey, event);
    return event;
  }

  async markEventStatus(
    eventKey: string,
    status: ExternalDepositEventStatus,
    input: {
      foxyaRegisteredAt?: string;
      foxyaCompletedAt?: string;
      lastError?: string;
      updatedAt?: string;
    } = {}
  ): Promise<ExternalDepositEvent> {
    const existing = this.events.get(eventKey);
    if (!existing) {
      throw new Error(`deposit monitor event not found: ${eventKey}`);
    }

    const updated: ExternalDepositEvent = {
      ...existing,
      status,
      foxyaRegisteredAt: input.foxyaRegisteredAt ?? existing.foxyaRegisteredAt,
      foxyaCompletedAt: input.foxyaCompletedAt ?? existing.foxyaCompletedAt,
      lastError: input.lastError,
      updatedAt: input.updatedAt ?? new Date().toISOString()
    };
    this.events.set(eventKey, updated);
    return updated;
  }

  async listRecentEvents(limit = 20): Promise<ExternalDepositEvent[]> {
    return [...this.events.values()]
      .sort((left, right) => right.blockTimestampMs - left.blockTimestampMs || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  async listEventsByStatus(status: ExternalDepositEventStatus, limit = 100): Promise<ExternalDepositEvent[]> {
    return [...this.events.values()]
      .filter((event) => event.status === status)
      .sort((left, right) => right.blockTimestampMs - left.blockTimestampMs || right.updatedAt.localeCompare(left.updatedAt))
      .slice(0, limit);
  }

  async countEventsByStatus(): Promise<Record<ExternalDepositEventStatus, number>> {
    const counts = Object.fromEntries(EVENT_STATUS_VALUES.map((status) => [status, 0])) as Record<
      ExternalDepositEventStatus,
      number
    >;

    for (const event of this.events.values()) {
      counts[event.status] += 1;
    }

    return counts;
  }
}
