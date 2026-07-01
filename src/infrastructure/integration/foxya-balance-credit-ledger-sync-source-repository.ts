import { Pool } from 'pg';
import type {
  FoxyaBalanceCreditLedgerSyncCandidate,
  FoxyaBalanceCreditLedgerSyncSourceRepository,
  FoxyaBalanceCreditSourceName
} from '../../application/ports/foxya-balance-credit-ledger-sync-repository.js';

type FoxyaBalanceCreditRow = {
  foxya_id: string | number;
  user_id: string | number;
  currency_code: string;
  amount: string;
  occurred_at: string;
};

type SourceDefinition = {
  journalType: string;
  referenceType: string;
  descriptionPrefix: string;
  query: string;
};

const SOURCE_DEFINITIONS: Record<FoxyaBalanceCreditSourceName, SourceDefinition> = {
  mining_history: {
    journalType: 'foxya_mining_credited',
    referenceType: 'foxya_mining_history',
    descriptionPrefix: 'foxya mining history',
    query: `
      select
        mh.id as foxya_id,
        mh.user_id,
        'KORI' as currency_code,
        mh.amount::numeric(36, 6)::text as amount,
        to_char(mh.created_at, 'YYYY-MM-DD HH24:MI:SS.US') as occurred_at
      from mining_history mh
      where mh.deleted_at is null
        and upper(mh.status) = 'COMPLETED'
        and upper($1) = 'KORI'
        and mh.user_id is not null
        and mh.amount > 0
        and (
          $2::timestamp is null
          or (mh.created_at, mh.id) > ($2::timestamp, $3::bigint)
        )
      order by mh.created_at asc, mh.id asc
      limit $4
    `
  },
  airdrop_transfer: {
    journalType: 'foxya_airdrop_credited',
    referenceType: 'foxya_airdrop_transfer',
    descriptionPrefix: 'foxya airdrop transfer',
    query: `
      select
        it.id as foxya_id,
        it.receiver_id as user_id,
        c.code as currency_code,
        it.amount::numeric(36, 6)::text as amount,
        to_char(coalesce(it.completed_at, it.created_at), 'YYYY-MM-DD HH24:MI:SS.US') as occurred_at
      from internal_transfers it
      join currency c on c.id = it.currency_id
      where it.deleted_at is null
        and upper(it.status) = 'COMPLETED'
        and upper(it.transaction_type) = 'AIRDROP_TRANSFER'
        and upper(c.code) = upper($1)
        and it.receiver_id is not null
        and it.amount > 0
        and (
          $2::timestamp is null
          or (coalesce(it.completed_at, it.created_at), it.id) > ($2::timestamp, $3::bigint)
        )
      order by coalesce(it.completed_at, it.created_at) asc, it.id asc
      limit $4
    `
  },
  payment_deposit: {
    journalType: 'foxya_payment_deposit_credited',
    referenceType: 'foxya_payment_deposit',
    descriptionPrefix: 'foxya payment deposit',
    query: `
      select
        pd.id as foxya_id,
        pd.user_id,
        c.code as currency_code,
        pd.amount::numeric(36, 6)::text as amount,
        to_char(pd.created_at, 'YYYY-MM-DD HH24:MI:SS.US') as occurred_at
      from payment_deposits pd
      join currency c on c.id = pd.currency_id
      where pd.deleted_at is null
        and upper(pd.status) = 'COMPLETED'
        and upper(c.code) = upper($1)
        and pd.user_id is not null
        and pd.amount > 0
        and (
          $2::timestamp is null
          or (pd.created_at, pd.id) > ($2::timestamp, $3::bigint)
        )
      order by pd.created_at asc, pd.id asc
      limit $4
    `
  },
  swap_to_kori: {
    journalType: 'foxya_swap_credited',
    referenceType: 'foxya_swap',
    descriptionPrefix: 'foxya swap to KORI',
    query: `
      select
        s.id as foxya_id,
        s.user_id,
        tc.code as currency_code,
        s.to_amount::numeric(36, 6)::text as amount,
        to_char(s.created_at, 'YYYY-MM-DD HH24:MI:SS.US') as occurred_at
      from swaps s
      join currency fc on fc.id = s.from_currency_id
      join currency tc on tc.id = s.to_currency_id
      where s.deleted_at is null
        and upper(s.status) = 'COMPLETED'
        and upper(tc.code) = upper($1)
        and upper(fc.code) <> upper($1)
        and s.user_id is not null
        and s.to_amount > 0
        and (
          $2::timestamp is null
          or (s.created_at, s.id) > ($2::timestamp, $3::bigint)
        )
      order by s.created_at asc, s.id asc
      limit $4
    `
  },
  exchange_to_kori: {
    journalType: 'foxya_exchange_credited',
    referenceType: 'foxya_exchange',
    descriptionPrefix: 'foxya exchange to KORI',
    query: `
      select
        e.id as foxya_id,
        e.user_id,
        tc.code as currency_code,
        e.to_amount::numeric(36, 6)::text as amount,
        to_char(e.created_at, 'YYYY-MM-DD HH24:MI:SS.US') as occurred_at
      from exchanges e
      join currency fc on fc.id = e.from_currency_id
      join currency tc on tc.id = e.to_currency_id
      where e.deleted_at is null
        and upper(e.status) = 'COMPLETED'
        and upper(tc.code) = upper($1)
        and upper(fc.code) <> upper($1)
        and e.user_id is not null
        and e.to_amount > 0
        and (
          $2::timestamp is null
          or (e.created_at, e.id) > ($2::timestamp, $3::bigint)
        )
      order by e.created_at asc, e.id asc
      limit $4
    `
  },
  referral_reward: {
    journalType: 'foxya_referral_reward_credited',
    referenceType: 'foxya_referral_reward',
    descriptionPrefix: 'foxya referral reward',
    query: `
      select
        it.id as foxya_id,
        it.receiver_id as user_id,
        c.code as currency_code,
        it.amount::numeric(36, 6)::text as amount,
        to_char(coalesce(it.completed_at, it.created_at), 'YYYY-MM-DD HH24:MI:SS.US') as occurred_at
      from internal_transfers it
      join currency c on c.id = it.currency_id
      where it.deleted_at is null
        and upper(it.status) = 'COMPLETED'
        and upper(it.transfer_type) = 'REFERRAL_REWARD'
        and upper(c.code) = upper($1)
        and it.receiver_id is not null
        and it.amount > 0
        and (
          $2::timestamp is null
          or (coalesce(it.completed_at, it.created_at), it.id) > ($2::timestamp, $3::bigint)
        )
      order by coalesce(it.completed_at, it.created_at) asc, it.id asc
      limit $4
    `
  }
};

export class PostgresFoxyaBalanceCreditLedgerSyncSourceRepository
  implements FoxyaBalanceCreditLedgerSyncSourceRepository
{
  constructor(private readonly pool: Pool) {}

  async listCompletedCredits(input: {
    sourceName: FoxyaBalanceCreditSourceName;
    currencyCode: string;
    cursor?: { lastOccurredAt: string; lastFoxyaId: number };
    limit: number;
  }): Promise<FoxyaBalanceCreditLedgerSyncCandidate[]> {
    const source = SOURCE_DEFINITIONS[input.sourceName];
    const result = await this.pool.query<FoxyaBalanceCreditRow>(
      source.query,
      [input.currencyCode, input.cursor?.lastOccurredAt ?? null, input.cursor?.lastFoxyaId ?? 0, input.limit]
    );

    return result.rows.map((row) => {
      const foxyaId = Number(row.foxya_id);
      return {
        sourceName: input.sourceName,
        foxyaId,
        userId: String(row.user_id),
        currencyCode: row.currency_code,
        amount: row.amount,
        occurredAt: row.occurred_at,
        journalType: source.journalType,
        referenceType: source.referenceType,
        referenceId: `${source.referenceType}:${foxyaId}`,
        description: `${source.descriptionPrefix} ${foxyaId}`
      };
    });
  }
}
