drop index if exists idx_wallet_lifecycle_jobs_status;
drop table if exists wallet_lifecycle_jobs;

alter table virtual_wallet_bindings
  drop constraint if exists ck_virtual_wallet_bindings_resource_status;

alter table virtual_wallet_bindings
  drop constraint if exists ck_virtual_wallet_bindings_activation_status;

alter table virtual_wallet_bindings
  drop column if exists resource_last_error,
  drop column if exists resource_released_at,
  drop column if exists resource_delegated_at,
  drop column if exists resource_status,
  drop column if exists activation_last_error,
  drop column if exists activation_reclaimed_at,
  drop column if exists activation_reclaim_tx_hash,
  drop column if exists activation_granted_at,
  drop column if exists activation_grant_tx_hash,
  drop column if exists activation_status;
