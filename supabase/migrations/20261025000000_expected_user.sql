-- Writes made for one account only. All browser tabs share one stored login,
-- so a request that a sync started for account A can be sent after account B
-- signed in in another tab, and would then be saved in B's account. These
-- variants take the account the app means and refuse anything else. The
-- one-argument versions stay for app versions that do not send it yet.

create function public.save_my_weights(entries jsonb, expected_user uuid)
returns table (log_date date, updated_at timestamptz, outcome text)
language plpgsql
set search_path = ''
as $$
begin
  if expected_user is distinct from auth.uid() then
    raise exception 'This request belongs to an account that is no longer signed in.' using errcode = '42501';
  end if;
  return query select * from public.save_my_weights(entries);
end
$$;
revoke all on function public.save_my_weights(jsonb, uuid) from public, anon;
grant execute on function public.save_my_weights(jsonb, uuid) to authenticated;

create function public.change_username(name text, expected_user uuid)
returns text
language plpgsql
set search_path = ''
as $$
begin
  if expected_user is distinct from auth.uid() then
    raise exception 'This request belongs to an account that is no longer signed in.' using errcode = '42501';
  end if;
  return public.change_username(name);
end
$$;
revoke all on function public.change_username(text, uuid) from public, anon;
grant execute on function public.change_username(text, uuid) to authenticated;
