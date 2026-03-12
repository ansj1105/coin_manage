delete from ledger_postings
where journal_id in (
  select journal_id
  from ledger_journals
  where reference_type = 'opening_balance'
);

delete from ledger_journals
where reference_type = 'opening_balance';

delete from ledger_accounts
where ledger_account_code = 'system:equity:opening_balance'
  and not exists (
    select 1
    from ledger_postings
    where ledger_account_code = 'system:equity:opening_balance'
  );
