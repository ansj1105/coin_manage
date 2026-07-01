import type {
  FoxyaBalanceCreditLedgerSyncCursor,
  FoxyaBalanceCreditLedgerSyncCursorRepository
} from '../../application/ports/foxya-balance-credit-ledger-sync-repository.js';

export class InMemoryFoxyaBalanceCreditLedgerSyncCursorRepository
  implements FoxyaBalanceCreditLedgerSyncCursorRepository
{
  private readonly cursors = new Map<string, FoxyaBalanceCreditLedgerSyncCursor>();

  async getCursor(cursorKey: string): Promise<FoxyaBalanceCreditLedgerSyncCursor | undefined> {
    const cursor = this.cursors.get(cursorKey);
    return cursor ? { ...cursor } : undefined;
  }

  async saveCursor(cursor: FoxyaBalanceCreditLedgerSyncCursor): Promise<void> {
    this.cursors.set(cursor.cursorKey, { ...cursor });
  }
}
