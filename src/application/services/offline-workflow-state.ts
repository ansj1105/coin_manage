import type { OutboxEvent } from '../../ledger/types.js';

export type OfflineWorkflowStage =
  | 'SERVER_ACCEPTED'
  | 'LEDGER_LOCKED'
  | 'COLLATERAL_RELEASED'
  | 'LEDGER_SYNCED'
  | 'FAILED'
  | 'DEAD_LETTERED';

export type OfflineSagaStatus =
  | 'ACCEPTED'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'DEAD_LETTERED';

export type OfflineFailureClass =
  | 'TRANSPORT'
  | 'AUTH'
  | 'BUSINESS'
  | 'CONFLICT'
  | 'SYSTEM'
  | 'UNKNOWN';

export const isOfflinePayOutboxEvent = (eventType: string) =>
  eventType === 'offline_pay.collateral.locked'
    || eventType === 'offline_pay.collateral.released'
    || eventType === 'offline_pay.settlement.finalized';

export const resolveOfflineWorkflowStage = (
  event: Pick<OutboxEvent, 'eventType' | 'status'>
): OfflineWorkflowStage | null => {
  if (!isOfflinePayOutboxEvent(event.eventType)) {
    return null;
  }

  if (event.status === 'dead_lettered') {
    return 'DEAD_LETTERED';
  }

  switch (event.eventType) {
    case 'offline_pay.collateral.locked':
      return 'LEDGER_LOCKED';
    case 'offline_pay.collateral.released':
      return 'COLLATERAL_RELEASED';
    case 'offline_pay.settlement.finalized':
      return 'LEDGER_SYNCED';
    default:
      return null;
  }
};

export const resolveOfflineSagaStatus = (
  event: Pick<OutboxEvent, 'status'>
): OfflineSagaStatus => {
  switch (event.status) {
    case 'pending':
      return 'ACCEPTED';
    case 'processing':
      return 'PROCESSING';
    case 'published':
      return 'COMPLETED';
    case 'dead_lettered':
      return 'DEAD_LETTERED';
    default:
      return 'FAILED';
  }
};

export const resolveOfflineFailureClass = (input: {
  deadLetterCategory?: OutboxEvent['deadLetterCategory'];
  lastError?: string | null;
}): OfflineFailureClass => {
  if (input.deadLetterCategory === 'network') {
    return 'TRANSPORT';
  }
  if (input.deadLetterCategory === 'state_conflict') {
    return 'CONFLICT';
  }
  if (input.deadLetterCategory === 'validation') {
    return 'BUSINESS';
  }
  if (input.deadLetterCategory === 'external_dependency') {
    return 'SYSTEM';
  }

  const normalized = (input.lastError ?? '').toUpperCase();
  if (!normalized) {
    return 'UNKNOWN';
  }
  if (normalized.includes('UNAUTHORIZED') || normalized.includes('AUTH')) {
    return 'AUTH';
  }
  if (normalized.includes('INSUFFICIENT') || normalized.includes('VALIDATION') || normalized.includes('INVALID')) {
    return 'BUSINESS';
  }
  if (normalized.includes('CONFLICT') || normalized.includes('MISMATCH') || normalized.includes('DUPLICATE')) {
    return 'CONFLICT';
  }
  if (normalized.includes('TIMEOUT') || normalized.includes('NETWORK') || normalized.includes('ECONN') || normalized.includes('FETCH')) {
    return 'TRANSPORT';
  }
  return 'SYSTEM';
};
