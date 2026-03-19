alter table outbox_events
  drop column if exists dead_letter_note,
  drop column if exists dead_letter_acknowledged_by,
  drop column if exists dead_letter_acknowledged_at;
