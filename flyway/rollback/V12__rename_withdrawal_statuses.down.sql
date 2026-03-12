UPDATE withdrawals
SET status = CASE status
  WHEN 'LEDGER_RESERVED' THEN 'pending_external_auth'
  WHEN 'PENDING_ADMIN' THEN CASE WHEN review_required_at IS NULL THEN 'requested' ELSE 'review_required' END
  WHEN 'ADMIN_APPROVED' THEN 'approved'
  WHEN 'TX_BROADCASTED' THEN 'broadcasted'
  WHEN 'COMPLETED' THEN 'confirmed'
  WHEN 'FAILED' THEN 'failed'
  WHEN 'REJECTED' THEN 'rejected'
  ELSE status
END
WHERE status IN (
  'LEDGER_RESERVED',
  'PENDING_ADMIN',
  'ADMIN_APPROVED',
  'TX_BROADCASTED',
  'COMPLETED',
  'FAILED',
  'REJECTED'
);
