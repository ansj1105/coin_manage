alter table outbox_events
  drop column if exists dead_lettered_at;
