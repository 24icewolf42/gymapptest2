-- Adds private workout plan sync and friend-only body-weight comparison.
create table if not exists public.workout_plans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.body_weight_logs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  weight_kg numeric(6,2) not null check (weight_kg > 0 and weight_kg < 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

alter table public.workout_plans enable row level security;
alter table public.body_weight_logs enable row level security;
grant select, insert, update, delete on public.workout_plans to authenticated;
grant select, insert, update, delete on public.body_weight_logs to authenticated;

drop policy if exists "Owners and accepted friends read workout plans" on public.workout_plans;
create policy "Owners and accepted friends read workout plans" on public.workout_plans
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.target_id = user_id) or
         (f.target_id = auth.uid() and f.requester_id = user_id))
    )
  );
drop policy if exists "Users create their own workout plan" on public.workout_plans;
create policy "Users create their own workout plan" on public.workout_plans
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users update their own workout plan" on public.workout_plans;
create policy "Users update their own workout plan" on public.workout_plans
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users remove their own workout plan" on public.workout_plans;
create policy "Users remove their own workout plan" on public.workout_plans
  for delete to authenticated using (user_id = auth.uid());

drop policy if exists "Owners and accepted friends read body weight" on public.body_weight_logs;
create policy "Owners and accepted friends read body weight" on public.body_weight_logs
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.target_id = user_id) or
         (f.target_id = auth.uid() and f.requester_id = user_id))
    )
  );
drop policy if exists "Users record their own body weight" on public.body_weight_logs;
create policy "Users record their own body weight" on public.body_weight_logs
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "Users update their own body weight" on public.body_weight_logs;
create policy "Users update their own body weight" on public.body_weight_logs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "Users delete their own body weight" on public.body_weight_logs;
create policy "Users delete their own body weight" on public.body_weight_logs
  for delete to authenticated using (user_id = auth.uid());
