-- Preserve all workout progress and aggregate stats across a user's devices.
alter table public.workout_data
  add column if not exists bypass_days jsonb not null default '{}'::jsonb,
  add column if not exists deleted_sessions jsonb not null default '[]'::jsonb,
  add column if not exists legacy_stats jsonb not null default '{}'::jsonb,
  add column if not exists stats_snapshot jsonb not null default '{}'::jsonb;

alter table public.workout_data
  drop constraint if exists workout_data_bypass_days_object,
  drop constraint if exists workout_data_deleted_sessions_array,
  drop constraint if exists workout_data_legacy_stats_object,
  drop constraint if exists workout_data_stats_snapshot_object;
alter table public.workout_data
  add constraint workout_data_bypass_days_object check (jsonb_typeof(bypass_days) = 'object'),
  add constraint workout_data_deleted_sessions_array check (jsonb_typeof(deleted_sessions) = 'array'),
  add constraint workout_data_legacy_stats_object check (jsonb_typeof(legacy_stats) = 'object'),
  add constraint workout_data_stats_snapshot_object check (jsonb_typeof(stats_snapshot) = 'object');

alter table public.leaderboard_stats
  add column if not exists total_seconds bigint not null default 0,
  add column if not exists current_streak integer not null default 0,
  add column if not exists best_streak integer not null default 0;

alter table public.leaderboard_stats
  drop constraint if exists leaderboard_stats_total_seconds_nonnegative,
  drop constraint if exists leaderboard_stats_current_streak_nonnegative,
  drop constraint if exists leaderboard_stats_best_streak_nonnegative;
alter table public.leaderboard_stats
  add constraint leaderboard_stats_total_seconds_nonnegative check (total_seconds >= 0),
  add constraint leaderboard_stats_current_streak_nonnegative check (current_streak >= 0),
  add constraint leaderboard_stats_best_streak_nonnegative check (best_streak >= 0);

alter table public.body_weight_logs
  add column if not exists updated_at timestamptz not null default now();
