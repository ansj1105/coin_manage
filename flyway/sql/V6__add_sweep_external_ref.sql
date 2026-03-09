ALTER TABLE sweep_records
  ADD COLUMN IF NOT EXISTS external_ref VARCHAR(255) NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sweep_records_external_ref_unique
  ON sweep_records (external_ref)
  WHERE external_ref IS NOT NULL;
