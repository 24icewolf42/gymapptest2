-- Gym dates: plan a gym visit (now or later) and let friends join.
-- Visible only to the host's accepted friends, or to the invited subset of them.
-- Requires 20261024000000_friendships.sql. Safe to run more than once.

create table if not exists public.gym_dates (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  duration_min integer not null default 90 check (duration_min between 15 and 360),
  gym text not null check (char_length(btrim(gym)) between 1 and 60),
  workout text check (workout is null or char_length(workout) <= 40),
  note text check (note is null or char_length(note) <= 200),
  invite_only boolean not null default false,
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists gym_dates_starts_at_idx on public.gym_dates (starts_at);
create index if not exists gym_dates_host_idx on public.gym_dates (host_id);

create table if not exists public.gym_date_invites (
  date_id uuid not null references public.gym_dates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  primary key (date_id, user_id)
);
create index if not exists gym_date_invites_user_idx on public.gym_date_invites (user_id);

create table if not exists public.gym_date_rsvps (
  date_id uuid not null references public.gym_dates(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  status text not null check (status in ('going', 'maybe', 'no')),
  checked_in_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (date_id, user_id)
);
create index if not exists gym_date_rsvps_user_idx on public.gym_date_rsvps (user_id);

alter table public.gym_dates enable row level security;
alter table public.gym_date_invites enable row level security;
alter table public.gym_date_rsvps enable row level security;
grant select, insert, update, delete on public.gym_dates to authenticated;
grant select, insert, delete on public.gym_date_invites to authenticated;
grant select, insert, update, delete on public.gym_date_rsvps to authenticated;

-- Policies on these tables reference each other, so visibility is decided by
-- security-definer helpers that read the tables directly (no policy recursion).
-- Each helper answers only for the signed-in user.
create or replace function public.gym_date_visible(d uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gym_dates g
    where g.id = d
      and (g.host_id = auth.uid() or (
        exists (
          select 1 from public.friend_requests f
          where f.status = 'accepted'
            and ((f.requester_id = auth.uid() and f.target_id = g.host_id)
              or (f.target_id = auth.uid() and f.requester_id = g.host_id))
        )
        and (not g.invite_only or exists (
          select 1 from public.gym_date_invites i where i.date_id = g.id and i.user_id = auth.uid()
        ))
      ))
  );
$$;

create or replace function public.gym_date_is_host(d uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.gym_dates g where g.id = d and g.host_id = auth.uid());
$$;

-- Open for replies until the session ends, unless the host cancelled it.
create or replace function public.gym_date_open(d uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.gym_dates g
    where g.id = d and g.cancelled_at is null
      and g.starts_at + make_interval(mins => g.duration_min) > now()
  );
$$;

revoke all on function public.gym_date_visible(uuid) from public, anon;
revoke all on function public.gym_date_is_host(uuid) from public, anon;
revoke all on function public.gym_date_open(uuid) from public, anon;
grant execute on function public.gym_date_visible(uuid) to authenticated;
grant execute on function public.gym_date_is_host(uuid) to authenticated;
grant execute on function public.gym_date_open(uuid) to authenticated;

drop policy if exists "Host and invited friends read gym dates" on public.gym_dates;
create policy "Host and invited friends read gym dates" on public.gym_dates
  for select to authenticated using (host_id = auth.uid() or public.gym_date_visible(id));
drop policy if exists "Users host their own gym dates" on public.gym_dates;
create policy "Users host their own gym dates" on public.gym_dates
  for insert to authenticated with check (host_id = auth.uid());
drop policy if exists "Hosts edit their gym dates" on public.gym_dates;
create policy "Hosts edit their gym dates" on public.gym_dates
  for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
drop policy if exists "Hosts delete their gym dates" on public.gym_dates;
create policy "Hosts delete their gym dates" on public.gym_dates
  for delete to authenticated using (host_id = auth.uid());

drop policy if exists "Host and invitee read invites" on public.gym_date_invites;
create policy "Host and invitee read invites" on public.gym_date_invites
  for select to authenticated using (user_id = auth.uid() or public.gym_date_is_host(date_id));
drop policy if exists "Hosts invite their friends" on public.gym_date_invites;
create policy "Hosts invite their friends" on public.gym_date_invites
  for insert to authenticated with check (public.gym_date_is_host(date_id) and public.is_friend(user_id));
drop policy if exists "Host or invitee remove invites" on public.gym_date_invites;
create policy "Host or invitee remove invites" on public.gym_date_invites
  for delete to authenticated using (user_id = auth.uid() or public.gym_date_is_host(date_id));

-- You see your own reply, every reply to dates you host, and replies from your own
-- friends. A friend-of-a-friend's reply stays hidden; it only shows up in the counts.
drop policy if exists "Friends read replies" on public.gym_date_rsvps;
create policy "Friends read replies" on public.gym_date_rsvps
  for select to authenticated using (
    user_id = auth.uid()
    or public.gym_date_is_host(date_id)
    or (public.gym_date_visible(date_id) and public.is_friend(user_id))
  );
drop policy if exists "Users reply to open dates they can see" on public.gym_date_rsvps;
create policy "Users reply to open dates they can see" on public.gym_date_rsvps
  for insert to authenticated with check (
    user_id = auth.uid() and public.gym_date_visible(date_id) and public.gym_date_open(date_id)
  );
drop policy if exists "Users change their reply while open" on public.gym_date_rsvps;
create policy "Users change their reply while open" on public.gym_date_rsvps
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid() and public.gym_date_visible(date_id) and public.gym_date_open(date_id));
drop policy if exists "Users remove their reply" on public.gym_date_rsvps;
create policy "Users remove their reply" on public.gym_date_rsvps
  for delete to authenticated using (user_id = auth.uid());

-- New dates must start between 15 minutes ago and 60 days ahead; the host is
-- always "going". Server time decides, so a wrong phone clock can't break it.
create or replace function public.gym_dates_before_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.starts_at is distinct from old.starts_at then
    if new.starts_at < now() - interval '15 minutes' or new.starts_at > now() + interval '60 days' then
      raise exception 'A gym date must start between now and 60 days from now' using errcode = '22023';
    end if;
  end if;
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.cancelled_at := null;
  end if;
  new.gym := btrim(new.gym);
  return new;
end;
$$;
drop trigger if exists gym_dates_before_write on public.gym_dates;
create trigger gym_dates_before_write before insert or update on public.gym_dates
  for each row execute function public.gym_dates_before_write();

create or replace function public.gym_dates_add_host()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.gym_date_rsvps (date_id, user_id, status)
  values (new.id, new.host_id, 'going')
  on conflict (date_id, user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.gym_dates_add_host() from public, anon, authenticated;
drop trigger if exists gym_dates_add_host on public.gym_dates;
create trigger gym_dates_add_host after insert on public.gym_dates
  for each row execute function public.gym_dates_add_host();

-- Check-in uses server time and only works from 30 minutes before the start
-- until the end; saying "no" clears it.
create or replace function public.gym_date_rsvps_before_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.gym_dates;
begin
  new.updated_at := now();
  if new.status = 'no' then
    new.checked_in_at := null;
  elsif new.checked_in_at is not null and (tg_op = 'INSERT' or old.checked_in_at is null) then
    select * into g from public.gym_dates where id = new.date_id;
    if now() < g.starts_at - interval '30 minutes'
       or now() > g.starts_at + make_interval(mins => g.duration_min) then
      raise exception 'Check-in opens 30 minutes before the start' using errcode = '22023';
    end if;
    new.checked_in_at := now();
    new.status := 'going';
  elsif tg_op = 'UPDATE' and new.checked_in_at is not null then
    new.checked_in_at := old.checked_in_at;
  end if;
  return new;
end;
$$;
revoke all on function public.gym_date_rsvps_before_write() from public, anon, authenticated;
drop trigger if exists gym_date_rsvps_before_write on public.gym_date_rsvps;
create trigger gym_date_rsvps_before_write before insert or update on public.gym_date_rsvps
  for each row execute function public.gym_date_rsvps_before_write();

-- Reply counts for dates the caller can see, including friends-of-friends they
-- cannot read individually.
create or replace function public.gym_date_counts(ids uuid[])
returns table (date_id uuid, going integer, maybe integer, here integer)
language sql
stable
security definer
set search_path = ''
as $$
  select r.date_id,
         count(*) filter (where r.status = 'going')::integer,
         count(*) filter (where r.status = 'maybe')::integer,
         count(*) filter (where r.checked_in_at is not null)::integer
  from public.gym_date_rsvps r
  where r.date_id = any (ids) and public.gym_date_visible(r.date_id)
  group by r.date_id;
$$;
revoke all on function public.gym_date_counts(uuid[]) from public, anon;
grant execute on function public.gym_date_counts(uuid[]) to authenticated;

-- Live updates in the app. Realtime still applies the policies above.
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['gym_dates', 'gym_date_rsvps', 'gym_date_invites'] loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end;
$$;
