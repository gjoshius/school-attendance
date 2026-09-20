-- Fixes the real security lapse found via 60_security_audit_rls_check.sql:
-- students and classes both still carry Supabase's original default-open
-- policies -- "Authenticated read" (using: true) and "Authenticated insert"
-- (with_check: true), both for role {authenticated} -- meaning ANY
-- signed-in account, including a self-signup nobody approved (no
-- teacher_registrations match, so zero profiles row, stuck on the app's
-- generic "pending" screen), can read or write these tables directly via
-- the REST API, completely bypassing the UI. This is the exact same shape
-- of gap already found and fixed on attendance (48/49) and profiles (51/52)
-- -- students and classes were just never audited until now.
--
-- students holds every child's full_name, grade_level, and registration
-- number -- the most sensitive table in this app, and the one this bug
-- exposed to the widest possible audience (anyone who can sign up at all).
--
-- Confirmed live policy set before this change (via 60_*.sql):
--   students | Authenticated read   | SELECT | {authenticated} | using: true
--   students | Authenticated insert | INSERT | {authenticated} | with_check: true
--   classes  | Authenticated read   | SELECT | {authenticated} | using: true
--   classes  | Authenticated insert | INSERT | {authenticated} | with_check: true
--
-- Replacement, matching the shape already used everywhere else in this
-- project (admins manage attendance / lesson notes / teacher attendance /
-- pending assignments / teacher registrations, all EXISTS-against-profiles
-- ALL policies): admins get full access, and any legitimate staff member
-- (teacher/assistant/admin) can read -- unchanged in practice for every
-- real teacher/assistant/admin, since that's the same roster visibility
-- the app's Students tab, class rosters, and Log Hours volunteer-eligibility
-- list already depend on. What's actually closed off is exactly the same
-- thing attendance/profiles closed off: an authenticated account that isn't
-- any of those three roles no longer sees or can modify anything here.
--
-- No teacher/assistant INSERT policy is added -- nothing in src/teacher.js
-- creates student rows; only the admin Students tab does, so admin-only
-- write access matches actual app behavior.

drop policy if exists "Authenticated read" on students;
drop policy if exists "Authenticated insert" on students;

create policy "admins manage students"
  on students for all
  using (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'))
  with check (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'));

create policy "staff can view all students"
  on students for select
  using (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role in ('teacher', 'assistant', 'admin')));

drop policy if exists "Authenticated read" on classes;
drop policy if exists "Authenticated insert" on classes;

create policy "admins manage classes"
  on classes for all
  using (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'))
  with check (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role = 'admin'));

create policy "staff can view classes"
  on classes for select
  using (exists (select 1 from profiles where profiles.id = (select auth.uid()) and profiles.role in ('teacher', 'assistant', 'admin')));

-- Confirm: "Authenticated read"/"Authenticated insert" should no longer
-- appear on either table, and each should now show the two new
-- admin-scoped / staff-scoped policies instead.
select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where tablename in ('students', 'classes')
order by tablename, cmd, policyname;
