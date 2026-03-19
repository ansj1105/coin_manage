alter table outbox_events
  add column if not exists dead_letter_category varchar(32) null,
  add column if not exists incident_ref varchar(128) null;
