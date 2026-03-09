CREATE TABLE IF NOT EXISTS deposit_monitor_cursors (
  scanner_key VARCHAR(64) PRIMARY KEY,
  network VARCHAR(16) NOT NULL,
  contract_address VARCHAR(128) NOT NULL,
  cursor_timestamp_ms BIGINT NOT NULL DEFAULT 0,
  last_scanned_block_number BIGINT NULL,
  last_seen_event_block_number BIGINT NULL,
  last_seen_tx_hash VARCHAR(128) NULL,
  last_error TEXT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS external_deposit_events (
  event_key VARCHAR(160) PRIMARY KEY,
  deposit_id VARCHAR(64) NOT NULL UNIQUE,
  user_id VARCHAR(64) NOT NULL,
  currency_id INTEGER NOT NULL,
  network VARCHAR(32) NOT NULL,
  from_address VARCHAR(128) NULL,
  to_address VARCHAR(128) NOT NULL,
  tx_hash VARCHAR(128) NOT NULL,
  event_index INTEGER NOT NULL DEFAULT 0,
  block_number BIGINT NOT NULL,
  block_timestamp_ms BIGINT NOT NULL,
  amount_raw NUMERIC(36, 0) NOT NULL,
  amount_decimal NUMERIC(36, 6) NOT NULL,
  status VARCHAR(16) NOT NULL,
  foxya_registered_at TIMESTAMPTZ NULL,
  foxya_completed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_external_deposit_events_status
    CHECK (status IN ('discovered', 'registered', 'completed'))
);

CREATE INDEX IF NOT EXISTS idx_external_deposit_events_status
  ON external_deposit_events (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_external_deposit_events_to_address
  ON external_deposit_events (to_address, block_number DESC);

CREATE INDEX IF NOT EXISTS idx_external_deposit_events_tx
  ON external_deposit_events (tx_hash, event_index);
