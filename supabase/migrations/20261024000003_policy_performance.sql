-- Re-creates the original policies with (select auth.uid()), which Postgres
-- evaluates once per query instead of once per row (Supabase performance
-- advisor). Behaviour is unchanged. Safe to run more than once.

drop policy if exists "Users create their profile" on public.profiles;
create policy "Users create their profile" on public.profiles
  for insert to authenticated with check (id = (select auth.uid()));
drop policy if exists "Users update their profile" on public.profiles;
create policy "Users update their profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

drop policy if exists "Participants read friend requests" on public.friend_requests;
create policy "Participants read friend requests" on public.friend_requests
  for select to authenticated using (requester_id = (select auth.uid()) or target_id = (select auth.uid()));
drop policy if exists "Users send friend requests" on public.friend_requests;
create policy "Users send friend requests" on public.friend_requests
  for insert to authenticated with check (requester_id = (select auth.uid()) and status = 'pending');
drop policy if exists "Recipient accepts request" on public.friend_requests;
create policy "Recipient accepts request" on public.friend_requests
  for update to authenticated using (target_id = (select auth.uid()) and status = 'pending')
  with check (target_id = (select auth.uid()) and status = 'accepted');

drop policy if exists "Owner or accepted friends read shared workouts" on public.shared_workouts;
create policy "Owner or accepted friends read shared workouts" on public.shared_workouts
  for select to authenticated using (
    owner_id = (select auth.uid()) or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = (select auth.uid()) and f.target_id = owner_id) or
         (f.target_id = (select auth.uid()) and f.requester_id = owner_id))
    )
  );
drop policy if exists "Users share their selected workouts" on public.shared_workouts;
create policy "Users share their selected workouts" on public.shared_workouts
  for insert to authenticated with check (owner_id = (select auth.uid()));
drop policy if exists "Owners remove their shared workouts" on public.shared_workouts;
create policy "Owners remove their shared workouts" on public.shared_workouts
  for delete to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "Owner or friends read published stats" on public.leaderboard_stats;
create policy "Owner or friends read published stats" on public.leaderboard_stats
  for select to authenticated using (
    user_id = (select auth.uid()) or exists (
      select 1 from public.friend_requests f
      where f.status = 'accepted' and
        ((f.requester_id = (select auth.uid()) and f.target_id = user_id) or
         (f.target_id = (select auth.uid()) and f.requester_id = user_id))
    )
  );
drop policy if exists "Users publish their own aggregate stats" on public.leaderboard_stats;
create policy "Users publish their own aggregate stats" on public.leaderboard_stats
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Users update their own aggregate stats" on public.leaderboard_stats;
create policy "Users update their own aggregate stats" on public.leaderboard_stats
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users remove their published stats" on public.leaderboard_stats;
create policy "Users remove their published stats" on public.leaderboard_stats
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Users create their own workout plan" on public.workout_plans;
create policy "Users create their own workout plan" on public.workout_plans
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Users update their own workout plan" on public.workout_plans;
create policy "Users update their own workout plan" on public.workout_plans
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users remove their own workout plan" on public.workout_plans;
create policy "Users remove their own workout plan" on public.workout_plans
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Users record their own body weight" on public.body_weight_logs;
create policy "Users record their own body weight" on public.body_weight_logs
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Users update their own body weight" on public.body_weight_logs;
create policy "Users update their own body weight" on public.body_weight_logs
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users delete their own body weight" on public.body_weight_logs;
create policy "Users delete their own body weight" on public.body_weight_logs
  for delete to authenticated using (user_id = (select auth.uid()));

drop policy if exists "Users read their own workout data" on public.workout_data;
create policy "Users read their own workout data" on public.workout_data
  for select to authenticated using (user_id = (select auth.uid()));
drop policy if exists "Users create their own workout data" on public.workout_data;
create policy "Users create their own workout data" on public.workout_data
  for insert to authenticated with check (user_id = (select auth.uid()));
drop policy if exists "Users update their own workout data" on public.workout_data;
create policy "Users update their own workout data" on public.workout_data
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
drop policy if exists "Users remove their own workout data" on public.workout_data;
create policy "Users remove their own workout data" on public.workout_data
  for delete to authenticated using (user_id = (select auth.uid()));
