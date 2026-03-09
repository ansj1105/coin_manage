DROP TABLE IF EXISTS sweep_records;
DROP TABLE IF EXISTS audit_logs;
DROP TABLE IF EXISTS withdrawal_approvals;

ALTER TABLE withdrawals
  DROP COLUMN IF EXISTS review_required_at,
  DROP COLUMN IF EXISTS device_id,
  DROP COLUMN IF EXISTS client_ip,
  DROP COLUMN IF EXISTS required_approvals,
  DROP COLUMN IF EXISTS risk_flags,
  DROP COLUMN IF EXISTS risk_score,
  DROP COLUMN IF EXISTS risk_level;
