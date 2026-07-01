import type { Kysely } from 'kysely';
import type {
  FoxyaBalanceCreditLedgerSyncCursor,
  FoxyaBalanceCreditLedgerSyncCursorRepository,
  FoxyaBalanceCreditSourceName
} from '../../../application/ports/foxya-balance-credit-ledger-sync-repository.js';
import type { KorionDatabase } from './db-schema.js';

export class PostgresFoxyaBalanceCreditLedgerSyncCursorRepository
  implements FoxyaBalanceCreditLedgerSyncCursorRepository
{
  constructor(private readonly db: Kysely<KorionDatabase>) {}

  async getCursor(cursorKey: string): Promise<FoxyaBalanceCreditLedgerSyncCursor | undefined> {
    const row = await this.db
      .selectFrom('foxya_balance_credit_ledger_sync_cursors')
      .selectAll()
      .where('cursor_key', '=', cursorKey)
      .executeTakeFirst();

    return row
      ? {
          cursorKey: row.cursor_key,
          sourceName: row.source_name as FoxyaBalanceCreditSourceName,
          currencyCode: row.currency_code,
          lastOccurredAt: row.last_occurred_at,
          lastFoxyaId: Number(row.last_foxya_id),
          updatedAt: row.updated_at
        }
      : undefined;
  }

  async saveCursor(cursor: FoxyaBalanceCreditLedgerSyncCursor): Promise<void> {
    await this.db
      .insertInto('foxya_balance_credit_ledger_sync_cursors')
      .values({
        cursor_key: cursor.cursorKey,
        source_name: cursor.sourceName,
        currency_code: cursor.currencyCode,
        last_occurred_at: cursor.lastOccurredAt,
        last_foxya_id: String(cursor.lastFoxyaId),
        updated_at: cursor.updatedAt
      })
      .onConflict((oc) =>
        oc.column('cursor_key').doUpdateSet({
          source_name: cursor.sourceName,
          currency_code: cursor.currencyCode,
          last_occurred_at: cursor.lastOccurredAt,
          last_foxya_id: String(cursor.lastFoxyaId),
          updated_at: cursor.updatedAt
        })
      )
      .execute();
  }
}
