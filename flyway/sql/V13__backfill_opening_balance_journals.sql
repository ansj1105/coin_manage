insert into ledger_accounts (ledger_account_code, account_type, currency_code, created_at)
values ('system:equity:opening_balance', 'equity', 'KORI', now())
on conflict (ledger_account_code) do nothing;

with accounts_to_backfill as (
  select
    a.user_id,
    a.balance,
    a.locked_balance,
    a.updated_at,
    (
      select count(*)
      from ledger_postings lp
      where lp.ledger_account_code in (
        'user:' || a.user_id || ':available',
        'user:' || a.user_id || ':withdraw_pending'
      )
    ) as existing_posting_count
  from accounts a
  where a.balance <> 0
     or a.locked_balance <> 0
),
pending_backfill as (
  select *
  from accounts_to_backfill
  where existing_posting_count = 0
),
insert_user_accounts as (
  insert into ledger_accounts (ledger_account_code, account_type, currency_code, created_at)
  select 'user:' || user_id || ':available', 'liability', 'KORI', updated_at
  from pending_backfill
  where balance <> 0
  union
  select 'user:' || user_id || ':withdraw_pending', 'liability', 'KORI', updated_at
  from pending_backfill
  where locked_balance <> 0
  on conflict (ledger_account_code) do nothing
  returning ledger_account_code
),
insert_journals as (
  insert into ledger_journals (journal_id, journal_type, reference_type, reference_id, description, created_at)
  select
    (
      substr(md5('opening-balance:' || user_id), 1, 8) || '-' ||
      substr(md5('opening-balance:' || user_id), 9, 4) || '-' ||
      substr(md5('opening-balance:' || user_id), 13, 4) || '-' ||
      substr(md5('opening-balance:' || user_id), 17, 4) || '-' ||
      substr(md5('opening-balance:' || user_id), 21, 12)
    )::uuid,
    'opening_balance',
    'opening_balance',
    'account:' || user_id,
    'opening balance backfill for ' || user_id,
    updated_at
  from pending_backfill
  on conflict (journal_id) do nothing
  returning journal_id, reference_id, created_at
)
insert into ledger_postings (posting_id, journal_id, ledger_account_code, entry_side, amount, created_at)
select
  (
    substr(md5(reference_id || ':equity'), 1, 8) || '-' ||
    substr(md5(reference_id || ':equity'), 9, 4) || '-' ||
    substr(md5(reference_id || ':equity'), 13, 4) || '-' ||
    substr(md5(reference_id || ':equity'), 17, 4) || '-' ||
    substr(md5(reference_id || ':equity'), 21, 12)
  )::uuid,
  journal_id,
  'system:equity:opening_balance',
  'debit',
  (
    select (pb.balance + pb.locked_balance)
    from pending_backfill pb
    where 'account:' || pb.user_id = insert_journals.reference_id
  ),
  created_at
from insert_journals
union all
select
  (
    substr(md5(reference_id || ':available'), 1, 8) || '-' ||
    substr(md5(reference_id || ':available'), 9, 4) || '-' ||
    substr(md5(reference_id || ':available'), 13, 4) || '-' ||
    substr(md5(reference_id || ':available'), 17, 4) || '-' ||
    substr(md5(reference_id || ':available'), 21, 12)
  )::uuid,
  journal_id,
  'user:' || replace(reference_id, 'account:', '') || ':available',
  'credit',
  (
    select pb.balance
    from pending_backfill pb
    where 'account:' || pb.user_id = insert_journals.reference_id
  ),
  created_at
from insert_journals
where exists (
  select 1
  from pending_backfill pb
  where 'account:' || pb.user_id = insert_journals.reference_id
    and pb.balance <> 0
)
union all
select
  (
    substr(md5(reference_id || ':withdraw_pending'), 1, 8) || '-' ||
    substr(md5(reference_id || ':withdraw_pending'), 9, 4) || '-' ||
    substr(md5(reference_id || ':withdraw_pending'), 13, 4) || '-' ||
    substr(md5(reference_id || ':withdraw_pending'), 17, 4) || '-' ||
    substr(md5(reference_id || ':withdraw_pending'), 21, 12)
  )::uuid,
  journal_id,
  'user:' || replace(reference_id, 'account:', '') || ':withdraw_pending',
  'credit',
  (
    select pb.locked_balance
    from pending_backfill pb
    where 'account:' || pb.user_id = insert_journals.reference_id
  ),
  created_at
from insert_journals
where exists (
  select 1
  from pending_backfill pb
  where 'account:' || pb.user_id = insert_journals.reference_id
    and pb.locked_balance <> 0
)
on conflict (posting_id) do nothing;
