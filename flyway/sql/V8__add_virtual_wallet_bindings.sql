create table if not exists virtual_wallet_bindings (
  virtual_wallet_id uuid primary key,
  user_id varchar(100) not null,
  currency_id integer not null,
  network varchar(20) not null,
  wallet_address varchar(255) not null,
  encrypted_private_key text not null,
  sweep_target_address varchar(255) not null,
  issued_by varchar(30) not null,
  idempotency_key varchar(255) not null unique,
  created_at timestamp not null,
  constraint fk_virtual_wallet_bindings_account
    foreign key (user_id) references accounts (user_id) on delete cascade,
  constraint uq_virtual_wallet_bindings_user_currency unique (user_id, currency_id),
  constraint uq_virtual_wallet_bindings_wallet_address unique (wallet_address),
  constraint ck_virtual_wallet_bindings_network check (network in ('mainnet', 'testnet')),
  constraint ck_virtual_wallet_bindings_issued_by check (issued_by in ('hot_wallet'))
);

create index if not exists idx_virtual_wallet_bindings_user_id
  on virtual_wallet_bindings (user_id);

create index if not exists idx_virtual_wallet_bindings_currency_network
  on virtual_wallet_bindings (currency_id, network);
