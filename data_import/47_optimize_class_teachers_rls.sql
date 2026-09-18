-- Fixes a Supabase database-linter warning ("auth_rls_initplan") on
-- public.class_teachers: the "teachers can view their own class links"
-- policy calls auth.uid() directly in its USING clause, so Postgres
-- re-evaluates auth.uid() once per row scanned instead of once per query.
-- Wrapping it as (select auth.uid()) lets Postgres treat it as a stable
-- sub-select and evaluate it once, which is the fix Supabase's own docs
-- recommend:
-- https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select
--
-- Confirmed live policy before this change (via
-- select policyname, cmd, qual, with_check from pg_policies
-- where tablename = 'class_teachers'):
--   policyname: teachers can view their own class links
--   cmd:        SELECT
--   qual:       (teacher_id = auth.uid())
--   with_check: NULL
-- This script reproduces that exact logic, only wrapping auth.uid().

drop policy if exists "teachers can view their own class links" on class_teachers;

create policy "teachers can view their own class links"
  on class_teachers for select
  using (teacher_id = (select auth.uid()));

-- Confirm: qual should now read teacher_id = ( SELECT auth.uid() AS uid)
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'class_teachers'
  and policyname = 'teachers can view their own class links';
