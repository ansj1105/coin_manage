drop table if exists network_fee_receipts;

alter table ledger_journals
  drop column if exists currency_code;
