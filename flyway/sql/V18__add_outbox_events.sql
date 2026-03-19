create table if not exists outbox_events (
  outbox_event_id uuid primary key,
  event_type varchar(100) not null,
  aggregate_type varchar(50) not null,
  aggregate_id varchar(64) not null,
  payload jsonb not null,
  status varchar(20) not null default 'pending',
  attempts integer not null default 0,
  available_at timestamptz not null,
  last_error text null,
  created_at timestamptz not null,
  published_at timestamptz null
);

create index if not exists idx_outbox_events_pending
  on outbox_events (status, available_at, created_at);
