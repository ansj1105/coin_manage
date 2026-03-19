alter table outbox_events
  add column if not exists dead_letter_acknowledged_at timestamptz null,
  add column if not exists dead_letter_acknowledged_by varchar(64) null,
  add column if not exists dead_letter_note text null;
