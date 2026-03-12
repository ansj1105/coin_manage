CREATE TABLE IF NOT EXISTS ledger_accounts (
  ledger_account_code VARCHAR(128) PRIMARY KEY,
  account_type VARCHAR(16) NOT NULL,
  currency_code VARCHAR(16) NOT NULL DEFAULT 'KORI',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ledger_journals (
  journal_id UUID PRIMARY KEY,
  journal_type VARCHAR(32) NOT NULL,
  reference_type VARCHAR(32) NOT NULL,
  reference_id VARCHAR(64) NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ledger_journals_reference
  ON ledger_journals (reference_type, reference_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ledger_postings (
  posting_id UUID PRIMARY KEY,
  journal_id UUID NOT NULL,
  ledger_account_code VARCHAR(128) NOT NULL,
  entry_side VARCHAR(8) NOT NULL,
  amount NUMERIC(36, 6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_ledger_postings_journal
    FOREIGN KEY (journal_id) REFERENCES ledger_journals(journal_id) ON DELETE CASCADE,
  CONSTRAINT fk_ledger_postings_account
    FOREIGN KEY (ledger_account_code) REFERENCES ledger_accounts(ledger_account_code),
  CONSTRAINT ck_ledger_postings_side
    CHECK (entry_side IN ('debit', 'credit'))
);

CREATE INDEX IF NOT EXISTS idx_ledger_postings_journal
  ON ledger_postings (journal_id);

CREATE INDEX IF NOT EXISTS idx_ledger_postings_account_created
  ON ledger_postings (ledger_account_code, created_at DESC);
