UPDATE deposits
SET status = CASE status
  WHEN 'CREDITED' THEN 'confirmed'
  ELSE status
END
WHERE status in ('CREDITED');
