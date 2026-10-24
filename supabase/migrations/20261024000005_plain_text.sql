-- No markup in names, notes and pictures, enforced by the database for every
-- app version: the original app (still on some phones) puts routine and
-- exercise names and the rest-day picture into the page unescaped, so a
-- friend's shared routine could otherwise run code there. This app removes
-- these characters before saving. Plans and history are checked on new
-- writes only (NOT VALID); existing shared routines are cleaned below.

alter table public.shared_workouts drop constraint if exists shared_workouts_plain_text;
alter table public.shared_workouts add constraint shared_workouts_plain_text
  check (title !~ '[<>"`]' and workout::text !~ '[<>`]|\\"') not valid;
-- Shared routines are copies offered to friends: any that already carry markup
-- are removed (the owner's own plan keeps the routine), so a payload planted
-- before this deploy can't reach the original app either.
delete from public.shared_workouts where title ~ '[<>"`]' or workout::text ~ '[<>`]|\\"';
alter table public.shared_workouts validate constraint shared_workouts_plain_text;

alter table public.workout_plans drop constraint if exists workout_plans_plain_text;
alter table public.workout_plans add constraint workout_plans_plain_text check (
  (plan - 'restImage')::text !~ '[<>`]|\\"'
  and (plan ->> 'restImage' is null or plan ->> 'restImage' ~ '^data:image/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$')
) not valid;

alter table public.workout_data drop constraint if exists workout_data_plain_text;
alter table public.workout_data add constraint workout_data_plain_text
  check (logs::text !~ '[<>`]|\\"') not valid;
