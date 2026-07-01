CREATE TABLE IF NOT EXISTS foxya_balance_credit_ledger_sync_cursors (
  cursor_key VARCHAR(128) PRIMARY KEY,
  source_name VARCHAR(64) NOT NULL,
  currency_code VARCHAR(16) NOT NULL DEFAULT 'KORI',
  last_occurred_at TIMESTAMPTZ NOT NULL,
  last_foxya_id BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_foxya_balance_credit_ledger_sync_cursors_source
  ON foxya_balance_credit_ledger_sync_cursors (source_name, currency_code);
