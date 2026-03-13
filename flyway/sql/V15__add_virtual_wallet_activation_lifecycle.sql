alter table virtual_wallet_bindings
  add column if not exists activation_status varchar(32) not null default 'pending_trx_grant',
  add column if not exists activation_grant_tx_hash varchar(128) null,
  add column if not exists activation_granted_at timestamptz null,
  add column if not exists activation_reclaim_tx_hash varchar(128) null,
  add column if not exists activation_reclaimed_at timestamptz null,
  add column if not exists activation_last_error text null,
  add column if not exists resource_status varchar(32) not null default 'idle',
  add column if not exists resource_delegated_at timestamptz null,
  add column if not exists resource_released_at timestamptz null,
  add column if not exists resource_last_error text null;

alter table virtual_wallet_bindings
  drop constraint if exists ck_virtual_wallet_bindings_activation_status;

alter table virtual_wallet_bindings
  add constraint ck_virtual_wallet_bindings_activation_status
  check (activation_status in ('pending_trx_grant', 'trx_granted', 'reclaim_pending', 'reclaimed', 'failed'));

alter table virtual_wallet_bindings
  drop constraint if exists ck_virtual_wallet_bindings_resource_status;

alter table virtual_wallet_bindings
  add constraint ck_virtual_wallet_bindings_resource_status
  check (resource_status in ('idle', 'delegate_pending', 'delegated', 'release_pending', 'released', 'failed'));

create table if not exists wallet_lifecycle_jobs (
  job_id uuid primary key,
  virtual_wallet_id uuid not null references virtual_wallet_bindings(virtual_wallet_id) on delete cascade,
  job_type varchar(32) not null,
  status varchar(16) not null default 'pending',
  attempt_count integer not null default 0,
  tx_hash varchar(128) null,
  error_message text null,
  not_before timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table wallet_lifecycle_jobs
  drop constraint if exists ck_wallet_lifecycle_jobs_type;

alter table wallet_lifecycle_jobs
  add constraint ck_wallet_lifecycle_jobs_type
  check (job_type in ('activation_grant', 'activation_reclaim', 'resource_delegate', 'resource_release'));

alter table wallet_lifecycle_jobs
  drop constraint if exists ck_wallet_lifecycle_jobs_status;

alter table wallet_lifecycle_jobs
  add constraint ck_wallet_lifecycle_jobs_status
  check (status in ('pending', 'running', 'done', 'failed'));

create index if not exists idx_wallet_lifecycle_jobs_status
  on wallet_lifecycle_jobs (status, job_type, created_at desc);
