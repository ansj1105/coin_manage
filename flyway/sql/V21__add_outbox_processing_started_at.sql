alter table outbox_events
  add column if not exists processing_started_at timestamptz null;
