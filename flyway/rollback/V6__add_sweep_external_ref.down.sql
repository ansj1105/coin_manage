DROP INDEX IF EXISTS idx_sweep_records_external_ref_unique;

ALTER TABLE sweep_records
  DROP COLUMN IF EXISTS external_ref;
