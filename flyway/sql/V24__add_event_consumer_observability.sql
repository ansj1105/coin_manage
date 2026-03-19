create table if not exists event_consumer_attempts (
  attempt_id uuid primary key,
  event_key varchar(128) not null,
  event_type varchar(128) not null,
  consumer_name varchar(64) not null,
  status varchar(16) not null,
  attempt_number integer not null,
  aggregate_id varchar(64) null,
  error_message text null,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_event_consumer_attempts_consumer_created
  on event_consumer_attempts (consumer_name, created_at desc);

create index if not exists idx_event_consumer_attempts_event_created
  on event_consumer_attempts (event_type, created_at desc);

create table if not exists event_consumer_dead_letters (
  dead_letter_id uuid primary key,
  event_key varchar(128) not null,
  event_type varchar(128) not null,
  consumer_name varchar(64) not null,
  aggregate_id varchar(64) null,
  payload jsonb not null,
  error_message text not null,
  failed_at timestamptz not null default now()
);

create index if not exists idx_event_consumer_dead_letters_consumer_failed
  on event_consumer_dead_letters (consumer_name, failed_at desc);

create index if not exists idx_event_consumer_dead_letters_event_failed
  on event_consumer_dead_letters (event_type, failed_at desc);

create table if not exists event_consumer_checkpoints (
  consumer_name varchar(64) not null,
  event_key varchar(128) not null,
  event_type varchar(128) not null,
  aggregate_id varchar(64) null,
  last_status varchar(16) not null,
  first_processed_at timestamptz not null default now(),
  last_processed_at timestamptz not null default now(),
  primary key (consumer_name, event_key)
);

create index if not exists idx_event_consumer_checkpoints_event_type
  on event_consumer_checkpoints (event_type, last_processed_at desc);
