import type {
  FoxyaTokenDepositLedgerSyncCursor,
  FoxyaTokenDepositLedgerSyncCursorRepository
} from '../../application/ports/foxya-token-deposit-ledger-sync-repository.js';

export class InMemoryFoxyaTokenDepositLedgerSyncCursorRepository
  implements FoxyaTokenDepositLedgerSyncCursorRepository
{
  private readonly cursors = new Map<string, FoxyaTokenDepositLedgerSyncCursor>();

  async getCursor(cursorKey: string): Promise<FoxyaTokenDepositLedgerSyncCursor | undefined> {
    const cursor = this.cursors.get(cursorKey);
    return cursor ? { ...cursor } : undefined;
  }

  async saveCursor(cursor: FoxyaTokenDepositLedgerSyncCursor): Promise<void> {
    this.cursors.set(cursor.cursorKey, { ...cursor });
  }
}
