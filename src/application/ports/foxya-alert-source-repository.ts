export type FoxyaAlertTable =
  | 'internal_transfers'
  | 'external_transfers'
  | 'token_deposits'
  | 'payment_deposits'
  | 'swaps'
  | 'exchanges';

export interface FoxyaAlertEvent {
  table: FoxyaAlertTable;
  id: number;
  eventId: string;
  occurredAt: string;
  title: string;
  lines: string[];
}

export interface FoxyaAlertSourceRepository {
  getMaxId(table: FoxyaAlertTable): Promise<number>;
  listNewEvents(table: FoxyaAlertTable, afterId: number, limit: number): Promise<FoxyaAlertEvent[]>;
}
