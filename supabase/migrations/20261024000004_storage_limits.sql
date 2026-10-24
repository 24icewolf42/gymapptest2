-- Per-account size limits, so a single account can't fill the database or make
-- its friends' leaderboard slow. They are far above real use (years of daily
-- workouts take a few MB). NOT VALID: only new writes are checked, so rows that
-- already exist never block this migration.

alter table public.workout_plans drop constraint if exists workout_plans_size;
alter table public.workout_plans add constraint workout_plans_size
  check (octet_length(plan::text) <= 1048576) not valid;

alter table public.workout_data drop constraint if exists workout_data_size;
alter table public.workout_data add constraint workout_data_size check (
  octet_length(logs::text) + octet_length(coalesce(progress::text, ''))
  + octet_length(deleted_sessions::text) + octet_length(daily_summaries::text) + octet_length(deleted_dates::text)
  + octet_length(bypass_days::text) + octet_length(legacy_stats::text) + octet_length(stats_snapshot::text) <= 8388608
) not valid;

-- Weigh-ins: a plausible date, and at most 20,000 per account (55 years of daily entries).
create or replace function private.body_weight_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.log_date < date '1900-01-01' or new.log_date > current_date + 2 then
    raise exception 'A weigh-in needs a date between 1900 and today' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.body_weight_logs b where b.user_id = new.user_id) >= 20000 then
    raise exception 'Too many weigh-ins on this account' using errcode = '54000';
  end if;
  return new;
end;
$$;
revoke all on function private.body_weight_limits() from public, anon, authenticated;
drop trigger if exists body_weight_limits on public.body_weight_logs;
create trigger body_weight_limits before insert or update on public.body_weight_logs
  for each row execute function private.body_weight_limits();
