CREATE TABLE IF NOT EXISTS wallet_address_bindings (
  user_id VARCHAR(64) PRIMARY KEY,
  wallet_address VARCHAR(128) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_wallet_address_bindings_account
    FOREIGN KEY (user_id) REFERENCES accounts(user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_wallet_address_bindings_wallet
  ON wallet_address_bindings (wallet_address);
