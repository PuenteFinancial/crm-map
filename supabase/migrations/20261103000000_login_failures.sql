-- Failed passcode sign-ins, so a lockout holds across every server instance (an in-memory
-- counter wouldn't on serverless). Only the server's secret key touches this table: RLS is on
-- with no policies, so the publishable key can't read or write it.
create table login_failures (
  id bigint generated always as identity primary key,
  email text not null,
  at timestamptz not null default now()
);

create index login_failures_email_at_idx on login_failures (email, at);

alter table login_failures enable row level security;
