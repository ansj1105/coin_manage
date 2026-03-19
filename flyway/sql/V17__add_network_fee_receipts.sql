alter table ledger_journals
  add column if not exists currency_code varchar(16) not null default 'KORI';

update ledger_journals
set currency_code = 'KORI'
where currency_code is null;

create table if not exists network_fee_receipts (
  fee_receipt_id uuid primary key,
  reference_type varchar(32) not null,
  reference_id varchar(64) not null,
  tx_hash varchar(128) not null,
  currency_code varchar(16) not null default 'TRX',
  fee_sun numeric(36, 0) not null,
  energy_used integer not null default 0,
  bandwidth_used integer not null default 0,
  confirmed_at timestamptz not null,
  created_at timestamptz not null default now(),
  constraint ck_network_fee_receipts_reference_type
    check (reference_type in ('withdrawal', 'sweep')),
  constraint ck_network_fee_receipts_currency_code
    check (currency_code in ('TRX')),
  constraint uq_network_fee_receipts_reference unique (reference_type, reference_id)
);

create index if not exists idx_network_fee_receipts_created_at
  on network_fee_receipts (created_at desc);
