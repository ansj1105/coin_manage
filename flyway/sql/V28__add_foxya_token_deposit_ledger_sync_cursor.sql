CREATE TABLE IF NOT EXISTS foxya_token_deposit_ledger_sync_cursors (
  cursor_key VARCHAR(96) PRIMARY KEY,
  last_confirmed_at VARCHAR(32) NOT NULL,
  last_foxya_id BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
