create table if not exists withdraw_address_policies (
  address varchar(64) not null,
  policy_type varchar(32) not null,
  reason text null,
  created_by varchar(64) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (address, policy_type)
);

alter table withdraw_address_policies
  drop constraint if exists ck_withdraw_address_policies_type;

alter table withdraw_address_policies
  add constraint ck_withdraw_address_policies_type
  check (policy_type in ('blacklist', 'whitelist', 'internal_blocked'));

create index if not exists idx_withdraw_address_policies_updated_at
  on withdraw_address_policies (updated_at desc);
