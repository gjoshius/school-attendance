-- Read-only security audit, answering Gaurav's question: "is there any
-- such security lapse where anyone can enter the application and still
-- shows pending."
--
-- Short version of what's already known from the files in this folder:
--   - src/auth.js's self-signup form (supabase.auth.signUp) has NO check
--     against teacher_registrations -- literally any email/password can
--     create a real, live-session Supabase Auth account, no confirmation
--     required (confirmations are off for this project).
--   - If that email has no matching teacher_registrations row, the signup
--     trigger (sync_teacher_profile_on_signup, in 08c/50/55) inserts ZERO
--     rows into profiles. At the APP UI level that's exactly "pending" --
--     main.js shows the generic no-role message, no dashboard. That part
--     is safe BY ITSELF, but it's a UI routing decision, not a security
--     boundary.
--   - The real boundary is Postgres RLS: a signed-in account like that
--     still has a valid access token, and can call the Supabase REST API
--     (PostgREST) directly for any table, bypassing this app's UI/routing
--     entirely. Whether that's a problem depends entirely on each table's
--     RLS policies -- if RLS is off, or a policy uses `using (true)`
--     (or grants to a role that includes an unapproved signed-in account),
--     that account can read or write real data despite showing "pending"
--     on screen.
--   - This exact pattern (an open `using (true)` policy) was already found
--     and fixed TWICE in this project -- on attendance's old "Authenticated
--     read"/"Authenticated insert" policies (48, 49) and on profiles' old
--     "Authenticated read" policy (51/52). Both were originally flagged by
--     Supabase's own database linter, not found by manual review.
--
-- What's NOT yet confirmed: no migration file in this folder ever created
-- or touched a policy for students, teacher_registrations,
-- pending_class_assignments, classes, teacher_attendance, or
-- class_lesson_notes. That doesn't necessarily mean they're unsafe --
-- attendance's and profiles' ORIGINAL policies (before 48/49/51 fixed them)
-- were also never captured as files, they predate this repo's data_import
-- folder -- but it does mean their current state can't be verified from
-- code here. This query checks all of them directly.
--
-- Run this in the Supabase SQL editor and paste back BOTH result sets.

-- ===== 1) Is RLS even turned on for each table? =====
-- rowsecurity = false means NO restriction at all for that table via the
-- API, regardless of any policy text -- the most dangerous possible state
-- for any table holding real data.
select
  schemaname,
  tablename,
  rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in (
    'students', 'teacher_registrations', 'pending_class_assignments',
    'classes', 'teacher_attendance', 'class_lesson_notes',
    'attendance', 'profiles', 'class_teachers', 'smile_box_entries'
  )
order by tablename;

-- ===== 2) Every policy that currently exists on each of those tables =====
-- Look specifically for: cmd = SELECT/INSERT/UPDATE/DELETE with
-- qual or with_check = "true" (wide open to anyone matching `roles`), or
-- roles including "public"/"anon" (not just "authenticated").
select
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and tablename in (
    'students', 'teacher_registrations', 'pending_class_assignments',
    'classes', 'teacher_attendance', 'class_lesson_notes',
    'attendance', 'profiles', 'class_teachers', 'smile_box_entries'
  )
order by tablename, cmd, policyname;
