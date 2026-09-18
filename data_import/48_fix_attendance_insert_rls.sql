-- Fixes a real authorization gap flagged by Supabase's database linter
-- (security, not just performance) on public.attendance: the "Authenticated
-- insert" policy had WITH CHECK (true), so any signed-in user -- not just a
-- teacher assigned to that class -- could insert an attendance row for any
-- student, any class, any date. RLS was effectively not protecting inserts
-- at all.
--
-- Confirmed live policy set on attendance before this change (via
-- select policyname, cmd, qual, with_check from pg_policies
-- where tablename = 'attendance'):
--   admins manage attendance              | ALL    | using/with_check: profiles.role = 'admin' for auth.uid()
--   Authenticated insert                  | INSERT | with_check: true                              <-- fixing this one
--   Authenticated read                    | SELECT | using: true
--   teachers view all attendance for ...  | SELECT | using: profiles.role = 'teacher' for auth.uid()
--   teachers rework their class attendance| UPDATE | using/with_check: class_id in (their class_teachers rows)
--
-- "admins manage attendance" is a separate ALL policy that already fully
-- covers admins (Postgres ORs every matching permissive policy together),
-- so this replacement only needs to correctly gate the teacher case -- it
-- doesn't need an admin carve-out of its own.
--
-- The real app only ever inserts attendance rows from src/teacher.js's
-- submission flow, which always sets class_id to a class the signed-in
-- teacher is actually linked to (via class_teachers) and marked_by to
-- their own user id. This policy reuses the exact same authorization
-- relationship "teachers rework their class attendance" (the existing
-- UPDATE policy on this table) already uses, for consistency, and adds
-- marked_by = auth.uid() so a teacher can't insert a row for their own
-- class but attribute it to a different marked_by.
--
-- Renamed from the generic "Authenticated insert" to something descriptive,
-- matching this table's other policy names.

drop policy if exists "Authenticated insert" on attendance;

create policy "teachers insert attendance for their own class"
  on attendance for insert
  with check (
    marked_by = (select auth.uid())
    and class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

-- Confirm: should show the new policy with the tightened with_check, and
-- "Authenticated insert" should no longer appear at all.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'attendance'
order by cmd, policyname;
