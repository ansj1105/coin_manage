import type { Kysely } from 'kysely';
import type {
  FoxyaTokenDepositLedgerSyncCursor,
  FoxyaTokenDepositLedgerSyncCursorRepository
} from '../../../application/ports/foxya-token-deposit-ledger-sync-repository.js';
import type { KorionDatabase } from './db-schema.js';

export class PostgresFoxyaTokenDepositLedgerSyncCursorRepository
  implements FoxyaTokenDepositLedgerSyncCursorRepository
{
  constructor(private readonly db: Kysely<KorionDatabase>) {}

  async getCursor(cursorKey: string): Promise<FoxyaTokenDepositLedgerSyncCursor | undefined> {
    const row = await this.db
      .selectFrom('foxya_token_deposit_ledger_sync_cursors')
      .selectAll()
      .where('cursor_key', '=', cursorKey)
      .executeTakeFirst();

    if (!row) {
      return undefined;
    }

    return {
      cursorKey: row.cursor_key,
      lastConfirmedAt: row.last_confirmed_at,
      lastFoxyaId: Number(row.last_foxya_id),
      updatedAt: row.updated_at
    };
  }

  async saveCursor(cursor: FoxyaTokenDepositLedgerSyncCursor): Promise<void> {
    await this.db
      .insertInto('foxya_token_deposit_ledger_sync_cursors')
      .values({
        cursor_key: cursor.cursorKey,
        last_confirmed_at: cursor.lastConfirmedAt,
        last_foxya_id: String(cursor.lastFoxyaId),
        updated_at: cursor.updatedAt
      })
      .onConflict((oc) =>
        oc.column('cursor_key').doUpdateSet({
          last_confirmed_at: cursor.lastConfirmedAt,
          last_foxya_id: String(cursor.lastFoxyaId),
          updated_at: cursor.updatedAt
        })
      )
      .execute();
  }
}
