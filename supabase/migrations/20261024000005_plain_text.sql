-- No markup from other people reaches the original app (still on some phones),
-- which puts routine and exercise names and the rest-day picture into the page
-- unescaped:
--  * shared routines (the only names that come from someone else) are refused
--    when they carry markup characters; this app cleans them before sharing,
--    and existing ones that carry them are removed;
--  * the rest-day picture must be image data; anything else is dropped (the
--    original app's "Reset" stores 'rest.png', which then means "none").
-- A user's own plan and history keep names exactly as typed: both apps
-- identify routines and workouts by name, and renaming them would duplicate
-- routines and workouts in the original app.

create or replace function private.clean_plan()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.plan ? 'restImage' and new.plan ->> 'restImage' is not null
     and new.plan ->> 'restImage' !~ '^data:image/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$' then
    new.plan := new.plan - 'restImage';
  end if;
  return new;
end;
$$;
revoke all on function private.clean_plan() from public, anon, authenticated;
drop trigger if exists workout_plans_clean on public.workout_plans;
create trigger workout_plans_clean before insert or update on public.workout_plans
  for each row execute function private.clean_plan();

-- Shared routines: refused when they carry markup; existing ones that do are
-- removed (the owner's own plan keeps the routine), so a payload planted
-- before this deploy can't reach the original app either.
alter table public.shared_workouts drop constraint if exists shared_workouts_plain_text;
alter table public.shared_workouts add constraint shared_workouts_plain_text
  check (title !~ '[<>"`]' and workout::text !~ '[<>`]|(^|[^\\])(\\\\)*\\"') not valid;
delete from public.shared_workouts where title ~ '[<>"`]' or workout::text ~ '[<>`]|(^|[^\\])(\\\\)*\\"';
alter table public.shared_workouts validate constraint shared_workouts_plain_text;

-- Earlier drafts of this migration cleaned or refused whole plans and histories.
alter table public.workout_plans drop constraint if exists workout_plans_plain_text;
alter table public.workout_data drop constraint if exists workout_data_plain_text;
drop trigger if exists workout_data_clean on public.workout_data;
drop function if exists private.clean_workout_data();
drop function if exists private.plain_json(jsonb);
