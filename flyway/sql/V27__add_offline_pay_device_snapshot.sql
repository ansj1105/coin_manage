create table if not exists offline_pay_devices (
  device_id varchar(128) primary key,
  user_id varchar(64) not null,
  status varchar(32) not null,
  key_version integer null,
  last_seen_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ck_offline_pay_devices_status
    check (status in ('ACTIVE', 'REVOKED'))
);

create index if not exists idx_offline_pay_devices_user_status
  on offline_pay_devices (user_id, status);

create index if not exists idx_offline_pay_devices_synced_at
  on offline_pay_devices (synced_at desc);
