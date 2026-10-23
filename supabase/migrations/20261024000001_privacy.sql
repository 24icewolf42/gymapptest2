-- Privacy for a young user base:
--   * usernames can no longer be listed; adding a friend needs the exact name
--   * friends see a summary (latest weight, plan counts), not full histories,
--     and weight is shared only if the user turns it on
--   * profiles are created on sign-up, so a taken username can't break sync
--   * users can delete their own account and all its data
-- Requires 20261024000000_friendships.sql. Safe to run more than once.

alter table public.profiles add column if not exists share_weight boolean not null default false;

-- Profiles: yourself, your friends, and anyone with a pending request to or from you.
drop policy if exists "Authenticated users can find usernames" on public.profiles;
drop policy if exists "Users read related profiles" on public.profiles;
create policy "Users read related profiles" on public.profiles
  for select to authenticated using (
    id = auth.uid() or exists (
      select 1 from public.friend_requests f
      where (f.requester_id = auth.uid() and f.target_id = profiles.id)
         or (f.target_id = auth.uid() and f.requester_id = profiles.id)
    )
  );

-- Exact-match lookup for "add friend". Returns nothing for unknown names.
create or replace function public.find_profile(name text)
returns table (id uuid, username text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.username from public.profiles p where p.username = lower(btrim(name)) and auth.uid() is not null;
$$;
revoke all on function public.find_profile(text) from public, anon;
grant execute on function public.find_profile(text) to authenticated;

-- Create the profile when the account is created. A taken or invalid username
-- gets a random one, which the user can change in Settings.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := lower(coalesce(new.raw_user_meta_data ->> 'username', ''));
begin
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
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Owners and accepted friends read workout plans" on public.workout_plans;
drop policy if exists "Users read their own workout plan" on public.workout_plans;
create policy "Users read their own workout plan" on public.workout_plans
  for select to authenticated using (user_id = auth.uid());

-- What friends see about each other.
create or replace function public.friend_summaries()
returns table (
  user_id uuid, username text, workouts_count integer, volume_kg_reps bigint,
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
  select p.id, p.username, s.workouts_count, s.volume_kg_reps,
         case when p.share_weight or p.id = auth.uid() then w.weight_kg end,
         case when p.share_weight or p.id = auth.uid() then w.log_date end,
         coalesce((select count(*) from jsonb_object_keys(coalesce(wp.plan -> 'workouts', '{}'::jsonb))), 0)::integer,
         coalesce((select sum(jsonb_array_length(v)) from jsonb_each(coalesce(wp.plan -> 'workouts', '{}'::jsonb)) as e(k, v)
                   where jsonb_typeof(v) = 'array'), 0)::integer
  from people x
  join public.profiles p on p.id = x.id
  left join public.leaderboard_stats s on s.user_id = p.id
  left join public.workout_plans wp on wp.user_id = p.id
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
  delete from auth.users where id = auth.uid();
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
