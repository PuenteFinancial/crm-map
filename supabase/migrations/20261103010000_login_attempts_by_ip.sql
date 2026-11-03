-- The shared passcode is the secret, so attempts are limited per client IP and overall rather
-- than per submitted email (which an attacker can vary freely). Every attempt is recorded
-- before the passcode is checked; a successful sign-in clears that IP's rows.
alter table login_failures rename to login_attempts;
alter table login_attempts add column ip text not null default 'unknown';
drop index login_failures_email_at_idx;
create index login_attempts_ip_at_idx on login_attempts (ip, at);
create index login_attempts_at_idx on login_attempts (at);

-- Team emails are compared exactly, so store them lowercased.
update team_members set email = lower(email);
