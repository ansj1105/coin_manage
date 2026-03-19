alter table withdrawal_approvals
  add column if not exists reason_code varchar(64) not null default 'manual_review_passed';
