drop index if exists idx_virtual_wallet_bindings_active_user_currency;

alter table virtual_wallet_bindings
  drop constraint if exists ck_virtual_wallet_bindings_status;

alter table virtual_wallet_bindings
  drop column if exists replaced_by_virtual_wallet_id,
  drop column if exists disabled_at,
  drop column if exists retired_at,
  drop column if exists status;

alter table virtual_wallet_bindings
  add constraint uq_virtual_wallet_bindings_user_currency unique (user_id, currency_id);

alter table sweep_records
  drop constraint if exists ck_sweep_records_network;

alter table sweep_records
  drop column if exists last_attempt_at,
  drop column if exists queued_at,
  drop column if exists attempt_count,
  drop column if exists network,
  drop column if exists currency_id;
