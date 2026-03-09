create table if not exists alert_monitor_cursors (
  monitor_key varchar(100) primary key,
  last_seen_id bigint not null,
  updated_at timestamp not null
);

create table if not exists health_check_states (
  target_key varchar(100) primary key,
  target_name varchar(100) not null,
  target_url varchar(500) not null,
  last_status varchar(20) not null,
  consecutive_failures integer not null default 0,
  last_checked_at timestamp not null,
  last_failure_at timestamp null,
  last_error varchar(1000) null
);
