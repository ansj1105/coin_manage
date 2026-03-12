UPDATE withdrawals
SET status = CASE status
  WHEN 'pending_external_auth' THEN 'LEDGER_RESERVED'
  WHEN 'requested' THEN 'PENDING_ADMIN'
  WHEN 'review_required' THEN 'PENDING_ADMIN'
  WHEN 'approved' THEN 'ADMIN_APPROVED'
  WHEN 'broadcasted' THEN 'TX_BROADCASTED'
  WHEN 'confirmed' THEN 'COMPLETED'
  WHEN 'failed' THEN 'FAILED'
  WHEN 'rejected' THEN 'REJECTED'
  ELSE status
END
WHERE status IN (
  'pending_external_auth',
  'requested',
  'review_required',
  'approved',
  'broadcasted',
  'confirmed',
  'failed',
  'rejected'
);
