-- Booking indicator for the weekly planner (v4.2.0).
-- null = free, 'pencil' = tentative hold, 'booked' = confirmed.
-- Run once in the Supabase SQL editor. Existing RLS policies on
-- planner_days already cover the new column; realtime picks it up as well.

alter table public.planner_days
  add column if not exists booking text
  check (booking in ('pencil', 'booked'));
