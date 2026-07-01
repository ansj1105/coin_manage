import { Pool } from 'pg';
import type {
  FoxyaTokenDepositLedgerSyncCandidate,
  FoxyaTokenDepositLedgerSyncSourceRepository
} from '../../application/ports/foxya-token-deposit-ledger-sync-repository.js';

type FoxyaTokenDepositRow = {
  foxya_id: string | number;
  deposit_id: string;
  user_id: string | number;
  currency_code: string;
  amount: string;
  tx_hash: string;
  to_address: string | null;
  block_number: string | number | null;
  confirmed_at: string;
};

export class PostgresFoxyaTokenDepositLedgerSyncSourceRepository
  implements FoxyaTokenDepositLedgerSyncSourceRepository
{
  constructor(private readonly pool: Pool) {}

  async listCompletedTokenDeposits(input: {
    currencyCode: string;
    cursor?: { lastConfirmedAt: string; lastFoxyaId: number };
    limit: number;
  }): Promise<FoxyaTokenDepositLedgerSyncCandidate[]> {
    const result = await this.pool.query<FoxyaTokenDepositRow>(
      `
        select
          td.id as foxya_id,
          td.deposit_id,
          td.user_id,
          c.code as currency_code,
          td.amount::numeric(36, 6)::text as amount,
          td.tx_hash,
          td.to_address,
          td.block_number,
          to_char(coalesce(td.confirmed_at, td.created_at), 'YYYY-MM-DD HH24:MI:SS.US') as confirmed_at
        from token_deposits td
        join currency c on c.id = td.currency_id
        where td.deleted_at is null
          and upper(td.status) = 'COMPLETED'
          and upper(c.code) = upper($1)
          and td.user_id is not null
          and td.tx_hash is not null
          and btrim(td.tx_hash) <> ''
          and td.amount > 0
          and coalesce(td.confirmed_at, td.created_at) is not null
          and (
            $2::timestamp is null
            or (coalesce(td.confirmed_at, td.created_at), td.id) > ($2::timestamp, $3::bigint)
          )
        order by coalesce(td.confirmed_at, td.created_at) asc, td.id asc
        limit $4
      `,
      [input.currencyCode, input.cursor?.lastConfirmedAt ?? null, input.cursor?.lastFoxyaId ?? 0, input.limit]
    );

    return result.rows.map((row) => ({
      foxyaId: Number(row.foxya_id),
      depositId: row.deposit_id,
      userId: String(row.user_id),
      currencyCode: row.currency_code,
      amount: row.amount,
      txHash: row.tx_hash,
      toAddress: row.to_address ?? undefined,
      blockNumber: row.block_number == null ? undefined : Number(row.block_number),
      confirmedAt: row.confirmed_at
    }));
  }
}
