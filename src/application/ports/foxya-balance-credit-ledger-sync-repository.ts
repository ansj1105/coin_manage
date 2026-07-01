export type FoxyaBalanceCreditSourceName =
  | 'mining_history'
  | 'airdrop_transfer'
  | 'payment_deposit'
  | 'swap_to_kori'
  | 'exchange_to_kori'
  | 'referral_reward';

export interface FoxyaBalanceCreditLedgerSyncCursor {
  cursorKey: string;
  sourceName: FoxyaBalanceCreditSourceName;
  currencyCode: string;
  lastOccurredAt: string;
  lastFoxyaId: number;
  updatedAt: string;
}

export interface FoxyaBalanceCreditLedgerSyncCandidate {
  sourceName: FoxyaBalanceCreditSourceName;
  foxyaId: number;
  userId: string;
  currencyCode: string;
  amount: string;
  occurredAt: string;
  journalType: string;
  referenceType: string;
  referenceId: string;
  description: string;
}

export interface FoxyaBalanceCreditLedgerSyncSourceRepository {
  listCompletedCredits(input: {
    sourceName: FoxyaBalanceCreditSourceName;
    currencyCode: string;
    cursor?: Pick<FoxyaBalanceCreditLedgerSyncCursor, 'lastOccurredAt' | 'lastFoxyaId'>;
    limit: number;
  }): Promise<FoxyaBalanceCreditLedgerSyncCandidate[]>;
}

export interface FoxyaBalanceCreditLedgerSyncCursorRepository {
  getCursor(cursorKey: string): Promise<FoxyaBalanceCreditLedgerSyncCursor | undefined>;
  saveCursor(cursor: FoxyaBalanceCreditLedgerSyncCursor): Promise<void>;
}
