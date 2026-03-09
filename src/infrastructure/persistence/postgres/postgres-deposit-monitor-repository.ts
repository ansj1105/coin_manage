import type { Kysely } from 'kysely';
import { sql } from 'kysely';
import type { DepositMonitorRepository } from '../../../application/ports/deposit-monitor-repository.js';
import type {
  DepositMonitorCursor,
  ExternalDepositEvent,
  ExternalDepositEventStatus
} from '../../../domain/deposit-monitor/types.js';
import type { KorionDatabase } from './db-schema.js';

const EVENT_STATUS_VALUES: ExternalDepositEventStatus[] = ['discovered', 'registered', 'completed'];

export class PostgresDepositMonitorRepository implements DepositMonitorRepository {
  constructor(private readonly db: Kysely<KorionDatabase>) {}

  async getCursor(scannerKey: string): Promise<DepositMonitorCursor | undefined> {
    const row = await this.db
      .selectFrom('deposit_monitor_cursors')
      .selectAll()
      .where('scanner_key', '=', scannerKey)
      .executeTakeFirst();

    return row ? this.mapCursor(row) : undefined;
  }

  async saveCursor(input: Omit<DepositMonitorCursor, 'updatedAt'> & { updatedAt?: string }): Promise<DepositMonitorCursor> {
    const updatedAt = input.updatedAt ?? new Date().toISOString();
    await this.db
      .insertInto('deposit_monitor_cursors')
      .values({
        scanner_key: input.scannerKey,
        network: input.network,
        contract_address: input.contractAddress,
        cursor_timestamp_ms: String(input.cursorTimestampMs),
        last_scanned_block_number: input.lastScannedBlockNumber ?? null,
        last_seen_event_block_number: input.lastSeenEventBlockNumber ?? null,
        last_seen_tx_hash: input.lastSeenTxHash ?? null,
        last_error: input.lastError ?? null,
        updated_at: updatedAt
      })
      .onConflict((oc) =>
        oc.column('scanner_key').doUpdateSet({
          network: input.network,
          contract_address: input.contractAddress,
          cursor_timestamp_ms: String(input.cursorTimestampMs),
          last_scanned_block_number: input.lastScannedBlockNumber ?? null,
          last_seen_event_block_number: input.lastSeenEventBlockNumber ?? null,
          last_seen_tx_hash: input.lastSeenTxHash ?? null,
          last_error: input.lastError ?? null,
          updated_at: updatedAt
        })
      )
      .execute();

    const row = await this.db
      .selectFrom('deposit_monitor_cursors')
      .selectAll()
      .where('scanner_key', '=', input.scannerKey)
      .executeTakeFirstOrThrow();

    return this.mapCursor(row);
  }

  async recordDiscoveredEvent(
    input: Omit<ExternalDepositEvent, 'createdAt' | 'updatedAt'> & { createdAt?: string }
  ): Promise<ExternalDepositEvent> {
    const createdAt = input.createdAt ?? new Date().toISOString();

    await this.db
      .insertInto('external_deposit_events')
      .values({
        event_key: input.eventKey,
        deposit_id: input.depositId,
        user_id: input.userId,
        currency_id: input.currencyId,
        network: input.network,
        from_address: input.fromAddress ?? null,
        to_address: input.toAddress,
        tx_hash: input.txHash,
        event_index: input.eventIndex,
        block_number: input.blockNumber,
        block_timestamp_ms: String(input.blockTimestampMs),
        amount_raw: input.amountRaw,
        amount_decimal: input.amountDecimal,
        status: input.status,
        foxya_registered_at: input.foxyaRegisteredAt ?? null,
        foxya_completed_at: input.foxyaCompletedAt ?? null,
        last_error: input.lastError ?? null,
        created_at: createdAt,
        updated_at: createdAt
      })
      .onConflict((oc) => oc.column('event_key').doNothing())
      .execute();

    const row = await this.db
      .selectFrom('external_deposit_events')
      .selectAll()
      .where('event_key', '=', input.eventKey)
      .executeTakeFirstOrThrow();

    return this.mapEvent(row);
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
    const existing = await this.db
      .selectFrom('external_deposit_events')
      .selectAll()
      .where('event_key', '=', eventKey)
      .executeTakeFirstOrThrow();

    await this.db
      .updateTable('external_deposit_events')
      .set({
        status,
        foxya_registered_at: input.foxyaRegisteredAt ?? existing.foxya_registered_at,
        foxya_completed_at: input.foxyaCompletedAt ?? existing.foxya_completed_at,
        last_error: input.lastError ?? null,
        updated_at: input.updatedAt ?? new Date().toISOString()
      })
      .where('event_key', '=', eventKey)
      .execute();

    const row = await this.db
      .selectFrom('external_deposit_events')
      .selectAll()
      .where('event_key', '=', eventKey)
      .executeTakeFirstOrThrow();

    return this.mapEvent(row);
  }

  async listRecentEvents(limit = 20): Promise<ExternalDepositEvent[]> {
    const rows = await this.db
      .selectFrom('external_deposit_events')
      .selectAll()
      .orderBy('block_timestamp_ms desc')
      .orderBy('updated_at desc')
      .limit(limit)
      .execute();

    return rows.map((row) => this.mapEvent(row));
  }

  async countEventsByStatus(): Promise<Record<ExternalDepositEventStatus, number>> {
    const counts = Object.fromEntries(EVENT_STATUS_VALUES.map((status) => [status, 0])) as Record<
      ExternalDepositEventStatus,
      number
    >;
    const rows = await this.db
      .selectFrom('external_deposit_events')
      .select(['status', sql<number>`count(*)::int`.as('count')])
      .groupBy('status')
      .execute();

    for (const row of rows) {
      counts[row.status] = row.count;
    }

    return counts;
  }

  private mapCursor(row: KorionDatabase['deposit_monitor_cursors']) : DepositMonitorCursor {
    return {
      scannerKey: row.scanner_key,
      network: row.network,
      contractAddress: row.contract_address,
      cursorTimestampMs: Number(row.cursor_timestamp_ms),
      lastScannedBlockNumber:
        row.last_scanned_block_number !== null ? Number(row.last_scanned_block_number) : undefined,
      lastSeenEventBlockNumber:
        row.last_seen_event_block_number !== null ? Number(row.last_seen_event_block_number) : undefined,
      lastSeenTxHash: row.last_seen_tx_hash ?? undefined,
      lastError: row.last_error ?? undefined,
      updatedAt: row.updated_at
    };
  }

  private mapEvent(row: KorionDatabase['external_deposit_events']): ExternalDepositEvent {
    return {
      eventKey: row.event_key,
      depositId: row.deposit_id,
      userId: row.user_id,
      currencyId: row.currency_id,
      network: row.network,
      fromAddress: row.from_address ?? undefined,
      toAddress: row.to_address,
      txHash: row.tx_hash,
      eventIndex: row.event_index,
      blockNumber: Number(row.block_number),
      blockTimestampMs: Number(row.block_timestamp_ms),
      amountRaw: row.amount_raw,
      amountDecimal: row.amount_decimal,
      status: row.status,
      foxyaRegisteredAt: row.foxya_registered_at ?? undefined,
      foxyaCompletedAt: row.foxya_completed_at ?? undefined,
      lastError: row.last_error ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }
}
