alter table outbox_events
  drop column if exists incident_ref,
  drop column if exists dead_letter_category;
