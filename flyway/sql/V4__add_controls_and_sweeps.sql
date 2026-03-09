ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS risk_level VARCHAR(16) NOT NULL DEFAULT 'low',
  ADD COLUMN IF NOT EXISTS risk_score INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS required_approvals INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS client_ip VARCHAR(64),
  ADD COLUMN IF NOT EXISTS device_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS review_required_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS withdrawal_approvals (
  approval_id UUID PRIMARY KEY,
  withdraw_id UUID NOT NULL,
  admin_id VARCHAR(64) NOT NULL,
  actor_type VARCHAR(16) NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_withdrawal_approvals_withdrawal
    FOREIGN KEY (withdraw_id) REFERENCES withdrawals(withdraw_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_withdrawal_approvals_unique_actor
  ON withdrawal_approvals (withdraw_id, admin_id);

CREATE INDEX IF NOT EXISTS idx_withdrawal_approvals_withdrawal_created
  ON withdrawal_approvals (withdraw_id, created_at ASC);

CREATE TABLE IF NOT EXISTS audit_logs (
  audit_id UUID PRIMARY KEY,
  entity_type VARCHAR(32) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(64) NOT NULL,
  actor_type VARCHAR(16) NOT NULL,
  actor_id VARCHAR(64) NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_created
  ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE TABLE IF NOT EXISTS sweep_records (
  sweep_id UUID PRIMARY KEY,
  source_wallet_code VARCHAR(32) NOT NULL,
  source_address VARCHAR(128) NOT NULL,
  target_address VARCHAR(128) NOT NULL,
  amount NUMERIC(36, 6) NOT NULL,
  status VARCHAR(16) NOT NULL,
  tx_hash VARCHAR(128),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  broadcasted_at TIMESTAMPTZ,
  confirmed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sweep_records_status_created
  ON sweep_records (status, created_at DESC);
