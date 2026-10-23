-- Keep calendar totals grouped by date and recomputed from workout logs.
alter table public.workout_data
  add column if not exists daily_summaries jsonb not null default '{}'::jsonb,
  add column if not exists deleted_dates jsonb not null default '{}'::jsonb;

alter table public.workout_data
  drop constraint if exists workout_data_daily_summaries_object,
  drop constraint if exists workout_data_deleted_dates_object;

alter table public.workout_data
  add constraint workout_data_daily_summaries_object
  check (jsonb_typeof(daily_summaries) = 'object'),
  add constraint workout_data_deleted_dates_object
  check (jsonb_typeof(deleted_dates) = 'object');
