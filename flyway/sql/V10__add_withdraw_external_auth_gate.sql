ALTER TABLE withdrawals
  ADD COLUMN IF NOT EXISTS external_auth_provider VARCHAR(64),
  ADD COLUMN IF NOT EXISTS external_auth_request_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS external_auth_confirmed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_withdrawals_external_auth_request
  ON withdrawals (external_auth_provider, external_auth_request_id);
