UPDATE deposits
SET status = CASE status
  WHEN 'confirmed' THEN 'CREDITED'
  ELSE status
END
WHERE status in ('confirmed');
