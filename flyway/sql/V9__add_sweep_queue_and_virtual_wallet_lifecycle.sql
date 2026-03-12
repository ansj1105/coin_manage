alter table sweep_records
  add column if not exists currency_id integer,
  add column if not exists network varchar(20),
  add column if not exists attempt_count integer not null default 0,
  add column if not exists queued_at timestamp,
  add column if not exists last_attempt_at timestamp;

update sweep_records
set network = 'mainnet'
where network is null;

alter table sweep_records
  alter column network set default 'mainnet';

alter table sweep_records
  add constraint ck_sweep_records_network
  check (network in ('mainnet', 'testnet'));

alter table virtual_wallet_bindings
  add column if not exists status varchar(20) not null default 'active',
  add column if not exists retired_at timestamp,
  add column if not exists disabled_at timestamp,
  add column if not exists replaced_by_virtual_wallet_id uuid null;

alter table virtual_wallet_bindings
  drop constraint if exists uq_virtual_wallet_bindings_user_currency;

alter table virtual_wallet_bindings
  drop constraint if exists ck_virtual_wallet_bindings_status;

alter table virtual_wallet_bindings
  add constraint ck_virtual_wallet_bindings_status
  check (status in ('active', 'retired', 'disabled'));

create unique index if not exists idx_virtual_wallet_bindings_active_user_currency
  on virtual_wallet_bindings (user_id, currency_id)
  where status = 'active';
