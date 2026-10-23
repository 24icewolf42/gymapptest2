-- Run in Supabase SQL Editor for a new project. All tables use row-level security.
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  created_at timestamptz not null default now()
);

create table if not exists public.friend_requests (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles(id) on delete cascade,
  target_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','accepted')),
  created_at timestamptz not null default now(),
  unique (requester_id, target_id),
  check (requester_id <> target_id)
);

create table if not exists public.shared_workouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  workout jsonb not null check (jsonb_typeof(workout) = 'array'),
  created_at timestamptz not null default now()
);

-- Contains only the aggregates the user explicitly publishes from the app.
create table if not exists public.leaderboard_stats (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  workouts_count integer not null check (workouts_count >= 0),
  volume_kg_reps bigint not null check (volume_kg_reps >= 0),
  updated_at timestamptz not null default now()
);

-- Each account can sync one editable routine library and weekly schedule.
create table if not exists public.workout_plans (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  updated_at timestamptz not null default now()
);

-- Body weight is private to the owner and accepted friends.
create table if not exists public.body_weight_logs (
  user_id uuid not null references public.profiles(id) on delete cascade,
  log_date date not null,
  weight_kg numeric(6,2) not null check (weight_kg > 0 and weight_kg < 1000),
  created_at timestamptz not null default now(),
  primary key (user_id, log_date)
);

alter table public.profiles enable row level security;
alter table public.friend_requests enable row level security;
alter table public.shared_workouts enable row level security;
alter table public.leaderboard_stats enable row level security;
alter table public.workout_plans enable row level security;
alter table public.body_weight_logs enable row level security;
grant select, insert, update, delete on public.profiles to authenticated;
grant select, insert, update, delete on public.friend_requests to authenticated;
grant select, insert, update, delete on public.shared_workouts to authenticated;
grant select, insert, update, delete on public.leaderboard_stats to authenticated;
grant select, insert, update, delete on public.workout_plans to authenticated;
grant select, insert, update, delete on public.body_weight_logs to authenticated;

create policy "Authenticated users can find usernames" on public.profiles
  for select to authenticated using (true);
create policy "Users create their profile" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "Users update their profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

create policy "Participants read friend requests" on public.friend_requests
  for select to authenticated using (requester_id = auth.uid() or target_id = auth.uid());
create policy "Users send friend requests" on public.friend_requests
  for insert to authenticated with check (requester_id = auth.uid() and status = 'pending');
create policy "Recipient accepts request" on public.friend_requests
  for update to authenticated using (target_id = auth.uid() and status = 'pending')
  with check (target_id = auth.uid() and status = 'accepted');

create policy "Owner or accepted friends read shared workouts" on public.shared_workouts
  for select to authenticated using (
    owner_id = auth.uid() or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.target_id = owner_id) or
         (f.target_id = auth.uid() and f.requester_id = owner_id))
    )
  );
create policy "Users share their selected workouts" on public.shared_workouts
  for insert to authenticated with check (owner_id = auth.uid());
create policy "Owners remove their shared workouts" on public.shared_workouts
  for delete to authenticated using (owner_id = auth.uid());

create policy "Owner or friends read published stats" on public.leaderboard_stats
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.target_id = user_id) or
         (f.target_id = auth.uid() and f.requester_id = user_id))
    )
  );
create policy "Users publish their own aggregate stats" on public.leaderboard_stats
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users update their own aggregate stats" on public.leaderboard_stats
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users remove their published stats" on public.leaderboard_stats
  for delete to authenticated using (user_id = auth.uid());

create policy "Owners and accepted friends read workout plans" on public.workout_plans
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.target_id = user_id) or
         (f.target_id = auth.uid() and f.requester_id = user_id))
    )
  );
create policy "Users create their own workout plan" on public.workout_plans
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users update their own workout plan" on public.workout_plans
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users remove their own workout plan" on public.workout_plans
  for delete to authenticated using (user_id = auth.uid());

create policy "Owners and accepted friends read body weight" on public.body_weight_logs
  for select to authenticated using (
    user_id = auth.uid() or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = auth.uid() and f.target_id = user_id) or
         (f.target_id = auth.uid() and f.requester_id = user_id))
    )
  );
create policy "Users record their own body weight" on public.body_weight_logs
  for insert to authenticated with check (user_id = auth.uid());
create policy "Users update their own body weight" on public.body_weight_logs
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "Users delete their own body weight" on public.body_weight_logs
  for delete to authenticated using (user_id = auth.uid());

