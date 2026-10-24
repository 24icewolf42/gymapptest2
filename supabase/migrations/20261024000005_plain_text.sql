-- No markup in names, notes and pictures, for every app version: the original
-- app (still on some phones) puts routine and exercise names and the rest-day
-- picture into the page unescaped, so a friend's shared routine could
-- otherwise run code there.
--
-- Plans and workout history are cleaned, not refused, because both apps
-- rewrite them in full on every sync: markup characters become look-alikes
-- (< > " ` -> ‹ › ” ’), as this app does itself, and a rest picture that is
-- not image data is dropped. Shared routines (written only by this app, which
-- cleans them first) are refused instead.

-- Replaces markup characters in every string and key of a JSON value. Works on
-- the JSON text: < > ` never have a meaning there, and a quote inside a string
-- is the only quote preceded by an odd number of backslashes.
create or replace function private.plain_json(j jsonb)
returns jsonb
language plpgsql
immutable
strict -- null in, null out (the NOT NULL constraints then refuse it)
set search_path = ''
as $$
declare
  t text := j::text;
  prev text;
begin
  if t !~ '[<>`]|\\"' then
    return j;
  end if;
  t := translate(t, '<>`', '‹›’');
  loop
    prev := t;
    t := regexp_replace(t, '(^|[^\\])((\\\\)*)\\"', '\1\2”', 'g');
    exit when t is not distinct from prev;
  end loop;
  return t::jsonb;
end;
$$;
revoke all on function private.plain_json(jsonb) from public, anon, authenticated;

create or replace function private.clean_plan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.plan ? 'restImage' and new.plan ->> 'restImage' is not null
     and new.plan ->> 'restImage' !~ '^data:image/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$' then
    new.plan := new.plan - 'restImage';
  end if;
  new.plan := private.plain_json(new.plan);
  return new;
end;
$$;
revoke all on function private.clean_plan() from public, anon, authenticated;
drop trigger if exists workout_plans_clean on public.workout_plans;
create trigger workout_plans_clean before insert or update on public.workout_plans
  for each row execute function private.clean_plan();

create or replace function private.clean_workout_data()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.logs := private.plain_json(new.logs);
  new.progress := private.plain_json(new.progress);
  return new;
end;
$$;
revoke all on function private.clean_workout_data() from public, anon, authenticated;
drop trigger if exists workout_data_clean on public.workout_data;
create trigger workout_data_clean before insert or update on public.workout_data
  for each row execute function private.clean_workout_data();

-- Shared routines: refused when they carry markup; existing ones that do are
-- removed (the owner's own plan keeps the routine), so a payload planted
-- before this deploy can't reach the original app either.
alter table public.shared_workouts drop constraint if exists shared_workouts_plain_text;
alter table public.shared_workouts add constraint shared_workouts_plain_text
  check (title !~ '[<>"`]' and workout::text !~ '[<>`]|(^|[^\\])(\\\\)*\\"') not valid;
delete from public.shared_workouts where title ~ '[<>"`]' or workout::text ~ '[<>`]|(^|[^\\])(\\\\)*\\"';
alter table public.shared_workouts validate constraint shared_workouts_plain_text;

-- Earlier drafts of this migration refused instead of cleaning.
alter table public.workout_plans drop constraint if exists workout_plans_plain_text;
alter table public.workout_data drop constraint if exists workout_data_plain_text;
