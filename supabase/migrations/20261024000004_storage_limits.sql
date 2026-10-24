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
  -- One writer per account at a time, so parallel requests can't all pass the count.
  perform pg_advisory_xact_lock(hashtextextended('weights:' || new.user_id::text, 0));
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

-- Shared routines and gym dates: a bounded number per account, so nobody can
-- fill the database or flood their friends' lists.
create or replace function private.count_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- One writer per account and table at a time, so parallel requests can't all pass the count.
  if tg_table_name = 'shared_workouts' then
    perform pg_advisory_xact_lock(hashtextextended('shared:' || new.owner_id::text, 0));
    if (select count(*) from public.shared_workouts s where s.owner_id = new.owner_id) >= 50 then
      raise exception 'You can share up to 50 routines' using errcode = '54000';
    end if;
  elsif tg_table_name = 'gym_dates' then
    perform pg_advisory_xact_lock(hashtextextended('dates:' || new.host_id::text, 0));
    if (select count(*) from public.gym_dates g where g.host_id = new.host_id and g.created_at > now() - interval '1 day') >= 20 then
      raise exception 'You can post up to 20 gym dates a day' using errcode = '54000';
    end if;
    if (select count(*) from public.gym_dates g where g.host_id = new.host_id and g.cancelled_at is null and g.starts_at > now()) >= 30 then
      raise exception 'You can have up to 30 upcoming gym dates' using errcode = '54000';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.count_limits() from public, anon, authenticated;
drop trigger if exists shared_workouts_count_limit on public.shared_workouts;
create trigger shared_workouts_count_limit before insert on public.shared_workouts
  for each row execute function private.count_limits();
drop trigger if exists gym_dates_count_limit on public.gym_dates;
create trigger gym_dates_count_limit before insert on public.gym_dates
  for each row execute function private.count_limits();
