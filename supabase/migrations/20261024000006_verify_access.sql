-- Stops the deploy that applies it if the live database has row-level
-- security policies (by name), callable functions (by signature), API-readable
-- views or live-update tables that these migrations don't define. Policies
-- with these names were re-created by the migrations before this one.
-- Policies combine with OR, so one extra permissive policy made in the
-- dashboard (e.g. "Enable read access for all users") would quietly undo the
-- privacy rules. If this fails, look at what it lists and drop it, or add it
-- here on purpose.
do $$
declare
  extra text;
begin
  select string_agg(p.tablename || ': ' || p.policyname, '; ') into extra
  from pg_policies p
  where p.schemaname = 'public'
    and (p.tablename, p.policyname) not in (values
    ('body_weight_logs', 'Users delete their own body weight'),
    ('body_weight_logs', 'Users read their own body weight'),
    ('body_weight_logs', 'Users record their own body weight'),
    ('body_weight_logs', 'Users update their own body weight'),
    ('friend_blocks', 'Users block others'),
    ('friend_blocks', 'Users see their blocks'),
    ('friend_blocks', 'Users unblock others'),
    ('friend_requests', 'Participants read friend requests'),
    ('friend_requests', 'Participants remove friend requests'),
    ('friend_requests', 'Recipient accepts request'),
    ('friend_requests', 'Users send friend requests'),
    ('gym_date_invites', 'Host and invitee read invites'),
    ('gym_date_invites', 'Host or invitee remove invites'),
    ('gym_date_invites', 'Hosts invite their friends'),
    ('gym_date_rsvps', 'Friends read replies'),
    ('gym_date_rsvps', 'Users change their reply while open'),
    ('gym_date_rsvps', 'Users remove their reply'),
    ('gym_date_rsvps', 'Users reply to open dates they can see'),
    ('gym_dates', 'Host and invited friends read gym dates'),
    ('gym_dates', 'Hosts edit their gym dates'),
    ('gym_dates', 'Users host their own gym dates'),
    ('leaderboard_stats', 'Owner or friends read published stats'),
    ('leaderboard_stats', 'Users publish their own aggregate stats'),
    ('leaderboard_stats', 'Users remove their published stats'),
    ('leaderboard_stats', 'Users update their own aggregate stats'),
    ('profiles', 'Users create their profile'),
    ('profiles', 'Users read related profiles'),
    ('profiles', 'Users update their profile'),
    ('shared_workouts', 'Owner or accepted friends read shared workouts'),
    ('shared_workouts', 'Owners remove their shared workouts'),
    ('shared_workouts', 'Users share their selected workouts'),
    ('workout_data', 'Users create their own workout data'),
    ('workout_data', 'Users read their own workout data'),
    ('workout_data', 'Users remove their own workout data'),
    ('workout_data', 'Users update their own workout data'),
    ('workout_plans', 'Users create their own workout plan'),
    ('workout_plans', 'Users read their own workout plan'),
    ('workout_plans', 'Users remove their own workout plan'),
    ('workout_plans', 'Users update their own workout plan'));
  if extra is not null then
    raise exception 'Unexpected row-level security policies: %', extra;
  end if;

  -- Exact signatures, so an overload left over from SQL-editor work is caught too.
  select string_agg(p.oid::regprocedure::text, '; ') into extra
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
    and p.oid::regprocedure::text not in ('change_username(text)', 'delete_my_account()', 'find_profile(text)', 'friend_summaries()', 'gym_date_counts(uuid[])', 'my_blocks()', 'save_my_weights(jsonb)',
      'change_username(text,uuid)', 'save_my_weights(jsonb,uuid)'); -- the last two from 20261025000000 (for new projects and the tests)
  if extra is not null then
    raise exception 'Unexpected functions callable through the API: %', extra;
  end if;

  select string_agg(c.relname, '; ') into extra
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;
  if extra is not null then
    raise exception 'Tables without row-level security: %', extra;
  end if;

  -- Views and other relations bypass row-level security unless built for it; the app needs none.
  select string_agg(c.relname, '; ') into extra
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('v', 'm', 'f')
    and (has_table_privilege('anon', c.oid, 'select') or has_table_privilege('authenticated', c.oid, 'select'));
  if extra is not null then
    raise exception 'Views readable through the API: %', extra;
  end if;

  -- Live updates may carry only gym dates (replies would reveal who joined).
  select string_agg(t.tablename, '; ') into extra
  from pg_publication_tables t
  where t.pubname = 'supabase_realtime' and t.schemaname = 'public' and t.tablename <> 'gym_dates';
  if extra is not null then
    raise exception 'Unexpected tables in live updates: %', extra;
  end if;
end;
$$;
