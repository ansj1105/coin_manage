alter table outbox_events
  drop column if exists processing_started_at;
