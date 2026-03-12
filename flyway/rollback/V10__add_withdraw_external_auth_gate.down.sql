DROP INDEX IF EXISTS idx_withdrawals_external_auth_request;

ALTER TABLE withdrawals
  DROP COLUMN IF EXISTS external_auth_confirmed_at,
  DROP COLUMN IF EXISTS external_auth_request_id,
  DROP COLUMN IF EXISTS external_auth_provider;
