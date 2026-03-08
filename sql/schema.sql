-- KORION KORI backend schema (PostgreSQL)

CREATE TABLE IF NOT EXISTS accounts (
  user_id VARCHAR(64) PRIMARY KEY,
  balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
  locked_balance NUMERIC(36, 6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS transactions (
  tx_id UUID PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  type VARCHAR(32) NOT NULL,
  amount NUMERIC(36, 6) NOT NULL,
  status VARCHAR(16) NOT NULL,
  block_tx VARCHAR(128),
  idempotency_key VARCHAR(128),
  related_user_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_transactions_account
    FOREIGN KEY (user_id) REFERENCES accounts(user_id)
);

CREATE INDEX IF NOT EXISTS idx_transactions_user_created
  ON transactions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS deposits (
  deposit_id UUID PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  tx_hash VARCHAR(128) NOT NULL UNIQUE,
  amount NUMERIC(36, 6) NOT NULL,
  status VARCHAR(16) NOT NULL,
  block_number BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_deposits_account
    FOREIGN KEY (user_id) REFERENCES accounts(user_id)
);

CREATE TABLE IF NOT EXISTS withdrawals (
  withdraw_id UUID PRIMARY KEY,
  user_id VARCHAR(64) NOT NULL,
  amount NUMERIC(36, 6) NOT NULL,
  to_address VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL,
  tx_hash VARCHAR(128),
  idempotency_key VARCHAR(128) NOT NULL UNIQUE,
  ledger_tx_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ,
  broadcasted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  fail_reason TEXT,
  CONSTRAINT fk_withdrawals_account
    FOREIGN KEY (user_id) REFERENCES accounts(user_id),
  CONSTRAINT fk_withdrawals_tx
    FOREIGN KEY (ledger_tx_id) REFERENCES transactions(tx_id)
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_created
  ON withdrawals (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS tx_jobs (
  job_id UUID PRIMARY KEY,
  type VARCHAR(32) NOT NULL,
  payload JSONB NOT NULL,
  status VARCHAR(16) NOT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tx_jobs_status_type
  ON tx_jobs (status, type);
