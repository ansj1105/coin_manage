export interface FoxyaTokenDepositLedgerSyncCursor {
  cursorKey: string;
  lastConfirmedAt: string;
  lastFoxyaId: number;
  updatedAt: string;
}

export interface FoxyaTokenDepositLedgerSyncCandidate {
  foxyaId: number;
  depositId: string;
  userId: string;
  currencyCode: string;
  amount: string;
  txHash: string;
  toAddress?: string;
  blockNumber?: number;
  confirmedAt: string;
}

export interface FoxyaTokenDepositLedgerSyncSourceRepository {
  listCompletedTokenDeposits(input: {
    currencyCode: string;
    cursor?: Pick<FoxyaTokenDepositLedgerSyncCursor, 'lastConfirmedAt' | 'lastFoxyaId'>;
    limit: number;
  }): Promise<FoxyaTokenDepositLedgerSyncCandidate[]>;
}

export interface FoxyaTokenDepositLedgerSyncCursorRepository {
  getCursor(cursorKey: string): Promise<FoxyaTokenDepositLedgerSyncCursor | undefined>;
  saveCursor(cursor: FoxyaTokenDepositLedgerSyncCursor): Promise<void>;
}
