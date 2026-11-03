-- A successful sign-in marks its own attempt ok instead of deleting rows, so it can't shrink the
-- overall count. Per-IP limits count failures since that IP's last success.
alter table login_attempts add column ok boolean not null default false;
create index login_attempts_ip_ok_at_idx on login_attempts (ip, ok, at);
