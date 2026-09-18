-- Fixes a live bug introduced by 51_fix_profiles_open_read.sql: every
-- profiles read now fails with
--   {"code":"42P17","message":"infinite recursion detected in policy for
--   relation \"profiles\""}
-- Confirmed live via a browser Network-tab request to /rest/v1/profiles
-- while signed in as an account whose profiles row genuinely exists with
-- role = 'admin' -- so this isn't a missing-row problem, it's the policy
-- itself. Since src/main.js calls getUserRole() (a profiles select) on
-- every single page load for every admin/teacher/assistant, this currently
-- blocks EVERYONE from reaching their dashboard, not just the one account
-- that surfaced it -- highest priority fix in this file.
--
-- Root cause: 51's policy embedded a subquery that reads profiles from
-- inside profiles' own USING clause --
--   using (
--     id = (select auth.uid())
--     or exists (select 1 from profiles p2 where p2.id = (select auth.uid())
--                and p2.role in ('admin','teacher','assistant'))
--   )
-- The inner "select ... from profiles p2" is itself subject to profiles'
-- RLS, i.e. the very policy being evaluated -- so Postgres has to apply
-- this USING clause again to figure out which p2 rows are visible, and
-- again, and again. It doesn't matter that the first disjunct (id =
-- auth.uid()) would short-circuit true for that inner row at runtime --
-- Postgres detects the structural self-reference at rewrite time, before
-- any such runtime short-circuit could apply, and refuses with 42P17.
--
-- This is the same shape of subquery used in 50_assistant_role.sql's
-- "teachers can view co-teachers on shared classes" policy on
-- class_teachers (also queries class_teachers from inside a class_teachers
-- policy) -- same latent bug, just not yet surfaced because nothing has
-- exercised a co-teacher read through the actual app (only via the SQL
-- Editor, which runs as postgres and bypasses RLS entirely, so it never
-- would have shown this). Fixed here too, proactively, rather than waiting
-- for that to also break.
--
-- Fix: move the "what's my own role" / "what classes do I teach" lookup
-- into a SECURITY DEFINER function. A SECURITY DEFINER function runs with
-- the privileges of the function's owner, which bypasses RLS for the
-- query *inside* the function -- so looking up your own role no longer
-- re-triggers profiles' policy, breaking the cycle. This is Supabase's own
-- documented pattern for this exact problem. `stable` (not `volatile`)
-- lets Postgres cache/inline the call efficiently within one query,
-- similar in spirit to the (select auth.uid()) wrapping already used
-- everywhere else in this app's policies.

create or replace function public.current_profile_role()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role from profiles where id = auth.uid()
$$;
grant execute on function public.current_profile_role() to authenticated;

create or replace function public.my_class_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select class_id from class_teachers where teacher_id = auth.uid()
$$;
grant execute on function public.my_class_ids() to authenticated;

-- profiles: same intent as 51's policy (read your own row always; read
-- everyone's if you're legitimate staff), just resolved through the
-- non-recursive function above instead of a raw self-referential subquery.
drop policy if exists "staff can view their own and each other's profile" on profiles;
create policy "staff can view their own and each other's profile"
  on profiles for select
  using (
    id = (select auth.uid())
    or public.current_profile_role() in ('admin', 'teacher', 'assistant')
  );

-- class_teachers: same intent as 50's co-teacher policy, same fix.
drop policy if exists "teachers can view co-teachers on shared classes" on class_teachers;
create policy "teachers can view co-teachers on shared classes"
  on class_teachers for select
  using (
    class_id in (select public.my_class_ids())
  );

-- Confirm both policies now reference the functions, not a raw subquery.
select tablename, policyname, qual
from pg_policies
where (tablename = 'profiles' and policyname = 'staff can view their own and each other''s profile')
   or (tablename = 'class_teachers' and policyname = 'teachers can view co-teachers on shared classes');
