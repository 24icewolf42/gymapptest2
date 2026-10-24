-- Closes a hole that let anyone forge an accepted friendship, lets people decline
-- requests, unfriend and block, and allows only one request per pair.
-- Safe to run more than once.

-- Helpers used by policies live in a schema the REST API does not expose, so
-- they cannot be called directly to probe other people's data.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- A request sent both ways (A->B and B->A) left two rows for one friendship.
-- Keep the accepted row, or the older one when both have the same status.
delete from public.friend_requests f
using public.friend_requests g
where f.id <> g.id
  and least(f.requester_id, f.target_id) = least(g.requester_id, g.target_id)
  and greatest(f.requester_id, f.target_id) = greatest(g.requester_id, g.target_id)
  and (
    (f.status = 'pending' and g.status = 'accepted') or
    (f.status = g.status and (f.created_at, f.id) > (g.created_at, g.id))
  );

create unique index if not exists friend_requests_pair_key
  on public.friend_requests (least(requester_id, target_id), greatest(requester_id, target_id));

-- Only the status column may change. The update policy alone let the recipient
-- rewrite requester_id and so "accept" a friendship with anyone.
revoke all on public.friend_requests from anon;
revoke update on public.friend_requests from authenticated;
grant update (status) on public.friend_requests to authenticated;

-- Blocking: the blocked person can no longer send requests or find the blocker.
create table if not exists public.friend_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
alter table public.friend_blocks enable row level security;
revoke all on public.friend_blocks from anon, authenticated;
grant select, insert, delete on public.friend_blocks to authenticated;

drop policy if exists "Users see their blocks" on public.friend_blocks;
create policy "Users see their blocks" on public.friend_blocks
  for select to authenticated using (blocker_id = (select auth.uid()));
drop policy if exists "Users block others" on public.friend_blocks;
create policy "Users block others" on public.friend_blocks
  for insert to authenticated with check (blocker_id = (select auth.uid()));
drop policy if exists "Users unblock others" on public.friend_blocks;
create policy "Users unblock others" on public.friend_blocks
  for delete to authenticated using (blocker_id = (select auth.uid()));

-- True when either person blocked the other (the blocked side cannot read the row).
create or replace function private.blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.friend_blocks k
    where (k.blocker_id = a and k.blocked_id = b) or (k.blocker_id = b and k.blocked_id = a)
  );
$$;
-- Only the definer triggers below call it.
revoke all on function private.blocked_between(uuid, uuid) from public, anon, authenticated;

-- Blocking ends any friendship or pending request between the two.
create or replace function private.friend_blocks_after_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.friend_requests
  where (requester_id = new.blocker_id and target_id = new.blocked_id)
     or (requester_id = new.blocked_id and target_id = new.blocker_id);
  return new;
end;
$$;
revoke all on function private.friend_blocks_after_insert() from public, anon, authenticated;
drop trigger if exists friend_blocks_after_insert on public.friend_blocks;
create trigger friend_blocks_after_insert after insert on public.friend_blocks
  for each row execute function private.friend_blocks_after_insert();

-- Every request ever sent, so cancelling requests does not reset the daily limit.
create table if not exists private.friend_request_log (
  requester_id uuid not null,
  sent_at timestamptz not null default now()
);
create index if not exists friend_request_log_idx on private.friend_request_log (requester_id, sent_at);

-- New requests: server time, at most 20 a day, never to or from someone blocked.
-- A request to someone who blocked the sender is dropped without an error
-- (and still counts), so the sender can't tell that they were blocked.
create or replace function private.friend_requests_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    if new.requester_id <> old.requester_id or new.target_id <> old.target_id or new.created_at <> old.created_at then
      raise exception 'Only the request status can change' using errcode = '42501';
    end if;
    return new;
  end if;
  new.created_at := now();
  if exists (select 1 from public.friend_blocks k where k.blocker_id = new.requester_id and k.blocked_id = new.target_id) then
    raise exception 'Unblock this person first' using errcode = '42501';
  end if;
  -- One sender at a time, so parallel requests cannot all pass the count.
  perform pg_advisory_xact_lock(hashtextextended('friend_request:' || new.requester_id::text, 0));
  delete from private.friend_request_log where sent_at < now() - interval '2 days';
  if (
    select count(*) from private.friend_request_log
    where requester_id = new.requester_id and sent_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'Too many friend requests today. Try again tomorrow.' using errcode = '54000';
  end if;
  insert into private.friend_request_log (requester_id) values (new.requester_id);
  if exists (select 1 from public.friend_blocks k where k.blocker_id = new.target_id and k.blocked_id = new.requester_id) then
    return null;
  end if;
  return new;
end;
$$;
revoke all on function private.friend_requests_guard() from public, anon, authenticated;
drop trigger if exists friend_requests_guard on public.friend_requests;
drop function if exists public.friend_requests_guard();
create trigger friend_requests_guard before insert or update on public.friend_requests
  for each row execute function private.friend_requests_guard();

-- Either person can withdraw: cancel an outgoing request, decline an incoming one, or unfriend.
drop policy if exists "Participants remove friend requests" on public.friend_requests;
create policy "Participants remove friend requests" on public.friend_requests
  for delete to authenticated using (requester_id = (select auth.uid()) or target_id = (select auth.uid()));

-- True when the signed-in user and `other` are accepted friends.
create or replace function private.is_friend(other uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.friend_requests f
    where f.status = 'accepted'
      and ((f.requester_id = (select auth.uid()) and f.target_id = other)
        or (f.target_id = (select auth.uid()) and f.requester_id = other))
  );
$$;
revoke all on function private.is_friend(uuid) from public, anon;
grant execute on function private.is_friend(uuid) to authenticated;
drop function if exists public.is_friend(uuid);
