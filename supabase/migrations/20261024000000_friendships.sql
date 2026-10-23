-- Closes a hole that let anyone forge an accepted friendship, lets people decline
-- requests and unfriend, and allows only one request per pair.
-- Safe to run more than once.

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

-- Only the status column may change. The update policy alone let the recipient
-- rewrite requester_id and so "accept" a friendship with anyone.
revoke update on public.friend_requests from authenticated;
grant update (status) on public.friend_requests to authenticated;

create or replace function public.friend_requests_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.requester_id <> old.requester_id or new.target_id <> old.target_id or new.created_at <> old.created_at) then
    raise exception 'Only the request status can change' using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and (
    select count(*) from public.friend_requests
    where requester_id = new.requester_id and status = 'pending' and created_at > now() - interval '1 day'
  ) >= 20 then
    raise exception 'Too many friend requests today' using errcode = '54000';
  end if;
  return new;
end;
$$;
drop trigger if exists friend_requests_guard on public.friend_requests;
create trigger friend_requests_guard before insert or update on public.friend_requests
  for each row execute function public.friend_requests_guard();

create unique index if not exists friend_requests_pair_key
  on public.friend_requests (least(requester_id, target_id), greatest(requester_id, target_id));

-- Either person can withdraw: cancel an outgoing request, decline an incoming one, or unfriend.
drop policy if exists "Participants remove friend requests" on public.friend_requests;
create policy "Participants remove friend requests" on public.friend_requests
  for delete to authenticated using (requester_id = auth.uid() or target_id = auth.uid());

-- True when the signed-in user and `other` are accepted friends.
create or replace function public.is_friend(other uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1 from public.friend_requests f
    where f.status = 'accepted'
      and ((f.requester_id = auth.uid() and f.target_id = other)
        or (f.target_id = auth.uid() and f.requester_id = other))
  );
$$;
revoke all on function public.is_friend(uuid) from public, anon;
grant execute on function public.is_friend(uuid) to authenticated;
