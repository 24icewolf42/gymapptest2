-- Privacy for a young user base:
--   * usernames can no longer be listed; adding a friend needs the exact name,
--     and lookups are rate-limited
--   * friends see a summary, not full histories; weight is shared only if the
--     user turns it on, stats only if they publish them
--   * leaderboard totals are computed from synced history, not taken on trust
--   * a deleted weigh-in stays deleted even if an older app version re-uploads it
--   * profiles are created on sign-up, so a taken username can't break sync
--   * sign-ups must confirm their age (14+) or a parent's permission
--   * users can delete their own account and all its data
-- Requires 20261024000000_friendships.sql and the 2026-10-23 workout-sync
-- migrations. Safe to run more than once.

alter table public.profiles add column if not exists share_weight boolean not null default false;

-- Profiles: yourself, and anyone you are friends with or have a pending request with.
drop policy if exists "Authenticated users can find usernames" on public.profiles;
drop policy if exists "Users read related profiles" on public.profiles;
create policy "Users read related profiles" on public.profiles
  for select to authenticated using (
    id = (select auth.uid()) or exists (
      select 1 from public.friend_requests f
      where (f.requester_id = (select auth.uid()) and f.target_id = profiles.id)
         or (f.target_id = (select auth.uid()) and f.requester_id = profiles.id)
    )
  );

-- Exact-match lookup for "add friend": 30 lookups an hour, nothing for unknown
-- names or for people who blocked you.
create table if not exists private.profile_lookups (
  user_id uuid not null,
  looked_up_at timestamptz not null default now()
);
create index if not exists profile_lookups_user_idx on private.profile_lookups (user_id, looked_up_at);

drop function if exists public.find_profile(text);
create function public.find_profile(name text)
returns table (id uuid, username text)
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    return;
  end if;
  -- One lookup at a time per user, so parallel calls cannot all pass the count.
  perform pg_advisory_xact_lock(hashtextextended('profile_lookup:' || me::text, 0));
  delete from private.profile_lookups where looked_up_at < now() - interval '1 day';
  if (select count(*) from private.profile_lookups l where l.user_id = me and l.looked_up_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many searches. Try again in an hour.' using errcode = '54000';
  end if;
  insert into private.profile_lookups (user_id) values (me);
  return query
    select p.id, p.username from public.profiles p
    where p.username = lower(btrim(name))
      and not exists (select 1 from public.friend_blocks k where k.blocker_id = p.id and k.blocked_id = me);
end;
$$;
revoke all on function public.find_profile(text) from public, anon;
grant execute on function public.find_profile(text) to authenticated;

-- Usernames of the people you blocked (you cannot read their profiles any more).
create or replace function public.my_blocks()
returns table (blocked_id uuid, username text, created_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select k.blocked_id, p.username, k.created_at
  from public.friend_blocks k join public.profiles p on p.id = k.blocked_id
  where k.blocker_id = auth.uid()
  order by k.created_at desc;
$$;
revoke all on function public.my_blocks() from public, anon;
grant execute on function public.my_blocks() to authenticated;

-- Sign-ups must confirm "14 or older, or a parent or guardian agreed". The
-- confirmation is kept where the user cannot change it later.
create table if not exists private.account_consents (
  user_id uuid primary key references auth.users(id) on delete cascade,
  age_confirmed_at timestamptz not null default now()
);

-- Create the profile when the account is created. A taken or invalid username
-- gets a random one; the app then asks the user to pick another.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
begin
  if coalesce(new.raw_user_meta_data ->> 'age_confirmed', '') <> 'true' then
    raise exception 'Please confirm you are 14 or older, or that a parent or guardian agreed.' using errcode = '23514';
  end if;
  insert into private.account_consents (user_id) values (new.id) on conflict (user_id) do nothing;
  if wanted !~ '^[a-z0-9_]{3,20}$' or exists (select 1 from public.profiles where username = wanted) then
    wanted := 'user_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  end if;
  insert into public.profiles (id, username) values (new.id, wanted) on conflict (id) do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Full weigh-in history and plans are private to the owner from now on.
drop policy if exists "Owners and accepted friends read body weight" on public.body_weight_logs;
drop policy if exists "Users read their own body weight" on public.body_weight_logs;
create policy "Users read their own body weight" on public.body_weight_logs
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Owners and accepted friends read workout plans" on public.workout_plans;
drop policy if exists "Users read their own workout plan" on public.workout_plans;
create policy "Users read their own workout plan" on public.workout_plans
  for select to authenticated using (user_id = (select auth.uid()));

-- Deleted weigh-ins: a later write with an older timestamp (an old app
-- version re-uploading its copy) is ignored. A newer entry for the day wins.
create table if not exists private.body_weight_tombstones (
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  deleted_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

create or replace function private.body_weight_after_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Account deletion cascades here too; skip when the profile is gone.
  if exists (select 1 from public.profiles where id = old.user_id) then
    insert into private.body_weight_tombstones (user_id, log_date, deleted_at)
    values (old.user_id, old.log_date, now())
    on conflict (user_id, log_date) do update set deleted_at = excluded.deleted_at;
  end if;
  return old;
end;
$$;

create or replace function private.body_weight_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  gone timestamptz;
begin
  select t.deleted_at into gone from private.body_weight_tombstones t
  where t.user_id = new.user_id and t.log_date = new.log_date;
  if gone is not null then
    if coalesce(new.updated_at, now()) <= gone then
      return null;
    end if;
    delete from private.body_weight_tombstones where user_id = new.user_id and log_date = new.log_date;
  end if;
  return new;
end;
$$;
revoke all on function private.body_weight_after_delete() from public, anon, authenticated;
revoke all on function private.body_weight_before_write() from public, anon, authenticated;
drop trigger if exists body_weight_after_delete on public.body_weight_logs;
create trigger body_weight_after_delete after delete on public.body_weight_logs
  for each row execute function private.body_weight_after_delete();
drop trigger if exists body_weight_before_write on public.body_weight_logs;
create trigger body_weight_before_write before insert or update on public.body_weight_logs
  for each row execute function private.body_weight_before_write();

-- Weigh-ins uploaded by a phone running this version, stored with server time.
-- An entry marked fresh was changed on that phone since its last upload and
-- overrides a deletion made elsewhere. Any other entry is a copy the phone
-- holds: a deletion recorded here wins unless the copy is newer than it
-- (updated_at, the time the entry was last changed), so stale copies stay
-- deleted and entries made after the deletion survive.
-- Returns one row per entry: outcome 'saved' (with the server time), 'deleted'
-- (a deletion recorded here wins) or 'date' (implausible date, not stored).
drop function if exists public.save_my_weights(jsonb);
create function public.save_my_weights(entries jsonb)
returns table (log_date date, updated_at timestamptz, outcome text)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  e jsonb;
  d date;
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if jsonb_typeof(entries) <> 'array' or jsonb_array_length(entries) > 400 then
    raise exception 'Send up to 400 weigh-ins at a time' using errcode = '22023';
  end if;
  for e in select value from jsonb_array_elements(entries) loop
    d := (e ->> 'log_date')::date;
    -- Implausible dates (a phone with a wrong clock) are skipped, not fatal.
    if d < date '1900-01-01' or d > current_date + 2 then
      log_date := d; updated_at := null; outcome := 'date';
      return next;
      continue;
    end if;
    if coalesce((e ->> 'fresh')::boolean, false) then
      delete from private.body_weight_tombstones t where t.user_id = auth.uid() and t.log_date = d;
    elsif exists (
      select 1 from private.body_weight_tombstones t
      where t.user_id = auth.uid() and t.log_date = d
        and (e ->> 'updated_at' is null or t.deleted_at >= (e ->> 'updated_at')::timestamptz)
    ) then
      log_date := d; updated_at := null; outcome := 'deleted';
      return next;
      continue;
    end if;
    insert into public.body_weight_logs as b (user_id, log_date, weight_kg, updated_at)
    values (auth.uid(), d, (e ->> 'weight_kg')::numeric, now())
    on conflict (user_id, log_date) do update set weight_kg = excluded.weight_kg, updated_at = now();
    log_date := d;
    updated_at := now();
    outcome := 'saved';
    return next;
  end loop;
end;
$$;
revoke all on function public.save_my_weights(jsonb) from public, anon;
grant execute on function public.save_my_weights(jsonb) to authenticated;

-- Totals from a synced history (sessions, seconds, kg x reps). Values that are
-- not plain numbers count as zero.
create or replace function private.workout_totals(logs jsonb)
returns table (workouts integer, seconds bigint, volume bigint)
language sql
immutable
set search_path = ''
as $$
  with sessions as (
    select s.value as s
    from jsonb_each(case when jsonb_typeof(logs) = 'object' then logs else '{}'::jsonb end) d
    cross join lateral jsonb_array_elements(case when jsonb_typeof(d.value) = 'array' then d.value else '[]'::jsonb end) s
    where jsonb_typeof(s.value) = 'object'
  ), sets as (
    select x.value as x
    from sessions
    cross join lateral jsonb_array_elements(case when jsonb_typeof(sessions.s -> 'exercises') = 'array' then sessions.s -> 'exercises' else '[]'::jsonb end) e
    cross join lateral jsonb_array_elements(case when jsonb_typeof(e.value -> 'sets') = 'array' then e.value -> 'sets' else '[]'::jsonb end) x
    where jsonb_typeof(x.value) = 'object'
  )
  select
    (select count(*) from sessions)::integer,
    (select coalesce(sum(case when (s ->> 'duration') ~ '^\d{1,7}(\.\d+)?$' then (s ->> 'duration')::numeric else 0 end), 0) from sessions)::bigint,
    (select coalesce(sum(
      (case when (x ->> 'w') ~ '^\d{1,4}(\.\d+)?$' then (x ->> 'w')::numeric else 0 end) *
      (case when (x ->> 'r') ~ '^\d{1,4}(\.\d+)?$' then (x ->> 'r')::numeric else 0 end)), 0) from sets)::bigint;
$$;
revoke all on function private.workout_totals(jsonb) from public, anon, authenticated;

-- What friends see about each other. Stats and plan counts only for people who
-- published them (a leaderboard row); totals come from their synced history
-- when there is one. Streaks are reported by the app, since they depend on the
-- weekly plan.
drop function if exists public.friend_summaries();
create function public.friend_summaries()
returns table (
  user_id uuid, username text, workouts_count integer, volume_kg_reps bigint,
  total_seconds bigint, current_streak integer, best_streak integer,
  weight_kg numeric, weight_date date, routines integer, exercises integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with people as (
    select auth.uid() as id
    union
    select case when f.requester_id = auth.uid() then f.target_id else f.requester_id end
    from public.friend_requests f
    where f.status = 'accepted' and (f.requester_id = auth.uid() or f.target_id = auth.uid())
  )
  select p.id, p.username,
         case when s.user_id is not null then coalesce(t.workouts, s.workouts_count) end,
         case when s.user_id is not null then coalesce(t.volume, s.volume_kg_reps) end,
         case when s.user_id is not null then coalesce(t.seconds, s.total_seconds) end,
         s.current_streak,
         s.best_streak,
         case when p.share_weight or p.id = auth.uid() then w.weight_kg end,
         case when p.share_weight or p.id = auth.uid() then w.log_date end,
         case when s.user_id is not null or p.id = auth.uid() then
           coalesce((select count(*) from jsonb_object_keys(case when jsonb_typeof(wp.plan -> 'workouts') = 'object' then wp.plan -> 'workouts' else '{}'::jsonb end)), 0)::integer end,
         case when s.user_id is not null or p.id = auth.uid() then
           coalesce((select sum(jsonb_array_length(v)) from jsonb_each(case when jsonb_typeof(wp.plan -> 'workouts') = 'object' then wp.plan -> 'workouts' else '{}'::jsonb end) as e(k, v)
                     where jsonb_typeof(v) = 'array'), 0)::integer end
  from people x
  join public.profiles p on p.id = x.id
  left join public.leaderboard_stats s on s.user_id = p.id
  left join public.workout_plans wp on wp.user_id = p.id
  left join public.workout_data wd on wd.user_id = p.id and s.user_id is not null
  left join lateral private.workout_totals(wd.logs) t on wd.user_id is not null
  left join lateral (
    select b.weight_kg, b.log_date from public.body_weight_logs b
    where b.user_id = p.id order by b.log_date desc limit 1
  ) w on true
  where auth.uid() is not null;
$$;
revoke all on function public.friend_summaries() from public, anon;
grant execute on function public.friend_summaries() to authenticated;

-- Shared routines: bounded size, and an index for the friends feed.
create index if not exists shared_workouts_owner_idx on public.shared_workouts (owner_id);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'shared_workouts_size_check') then
    alter table public.shared_workouts add constraint shared_workouts_size_check
      check (jsonb_array_length(workout) <= 60 and pg_column_size(workout) < 32768) not valid;
  end if;
end;
$$;

-- Deletes the signed-in account. Every table cascades from auth.users.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  -- Sign-in records mention the email address; remove them too.
  delete from auth.audit_log_entries a
  where a.payload ->> 'actor_id' = auth.uid()::text
     or a.payload -> 'traits' ->> 'user_id' = auth.uid()::text
     or a.payload ->> 'actor_username' = (select email from auth.users where id = auth.uid());
  -- Rate-limit records are keyed by the user id; they go too.
  delete from private.friend_request_log where requester_id = auth.uid();
  delete from private.profile_lookups where user_id = auth.uid();
  delete from auth.flow_state where user_id = auth.uid();
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Changing the username goes through this function: a taken name would
-- otherwise confirm that an account exists, so each attempt counts toward the
-- same 30-an-hour budget as username lookups.
create or replace function public.change_username(name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
  wanted text := lower(btrim(coalesce(name, '')));
begin
  if me is null then
    raise exception 'Not signed in' using errcode = '42501';
  end if;
  if wanted !~ '^[a-z0-9_]{3,20}$' then
    return 'invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('profile_lookup:' || me::text, 0));
  if (select count(*) from private.profile_lookups l where l.user_id = me and l.looked_up_at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many username checks. Try again in an hour.' using errcode = '54000';
  end if;
  insert into private.profile_lookups (user_id) values (me);
  perform set_config('app.username_change', 'on', true);
  begin
    update public.profiles set username = wanted where id = me;
  exception when unique_violation then
    return 'taken';
  end;
  return 'ok';
end;
$$;
revoke all on function public.change_username(text) from public, anon;
grant execute on function public.change_username(text) to authenticated;

-- Any other update keeps the username as it is (no error, so nothing is
-- revealed, and the original app's profile upsert keeps working).
create or replace function private.profiles_keep_username()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.username is distinct from old.username and current_setting('app.username_change', true) is distinct from 'on' then
    new.username := old.username;
  end if;
  return new;
end;
$$;
revoke all on function private.profiles_keep_username() from public, anon, authenticated;
drop trigger if exists profiles_keep_username on public.profiles;
create trigger profiles_keep_username before update on public.profiles
  for each row execute function private.profiles_keep_username();
