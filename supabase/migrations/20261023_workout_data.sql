-- Private session history and exercise progress synced between the user's devices.
create table if not exists public.workout_data (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  logs jsonb not null default '{}'::jsonb check (jsonb_typeof(logs) = 'object'),
  progress jsonb not null default '{}'::jsonb check (jsonb_typeof(progress) = 'object'),
  updated_at timestamptz not null default now()
);

alter table public.workout_data enable row level security;
grant select, insert, update, delete on public.workout_data to authenticated;

drop policy if exists "Users read their own workout data" on public.workout_data;
create policy "Users read their own workout data" on public.workout_data
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "Users create their own workout data" on public.workout_data;
create policy "Users create their own workout data" on public.workout_data
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users update their own workout data" on public.workout_data;
create policy "Users update their own workout data" on public.workout_data
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users remove their own workout data" on public.workout_data;
create policy "Users remove their own workout data" on public.workout_data
  for delete to authenticated using (user_id = auth.uid());
