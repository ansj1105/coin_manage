alter table outbox_events
  add column if not exists dead_lettered_at timestamptz null;
