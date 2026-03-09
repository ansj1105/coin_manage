import type {
  DepositMonitorCursor,
  ExternalDepositEvent,
  ExternalDepositEventStatus
} from '../../domain/deposit-monitor/types.js';

export interface DepositMonitorRepository {
  getCursor(scannerKey: string): Promise<DepositMonitorCursor | undefined>;
  saveCursor(input: Omit<DepositMonitorCursor, 'updatedAt'> & { updatedAt?: string }): Promise<DepositMonitorCursor>;
  recordDiscoveredEvent(input: Omit<ExternalDepositEvent, 'createdAt' | 'updatedAt'> & { createdAt?: string }): Promise<ExternalDepositEvent>;
  markEventStatus(
    eventKey: string,
    status: ExternalDepositEventStatus,
    input?: {
      foxyaRegisteredAt?: string;
      foxyaCompletedAt?: string;
      lastError?: string;
      updatedAt?: string;
    }
  ): Promise<ExternalDepositEvent>;
  listRecentEvents(limit?: number): Promise<ExternalDepositEvent[]>;
  countEventsByStatus(): Promise<Record<ExternalDepositEventStatus, number>>;
}
