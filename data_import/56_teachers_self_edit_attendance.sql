-- Lets a teacher edit today's already-submitted attendance themselves,
-- straight from the "already submitted" screen (see src/teacher.js's new
-- "Edit Attendance" button), instead of only being able to fix a mistake
-- by asking an admin to flag it for rework first
-- (data_import/22_attendance_rework_flag.sql, not present in this repo --
-- run directly against Supabase before this file's migration numbering
-- started).
--
-- Why this needs a policy change at all, and why it's additive rather than
-- touching any existing policy: this repo doesn't have 22's or 18's (the
-- original teacher_attendance setup) SQL on file to inspect directly, and
-- 48_fix_attendance_insert_rls.sql's own confirmation dump of `attendance`
-- suggests its existing "teachers rework their class attendance" UPDATE
-- policy may only check class ownership already (not needs_rework) -- but
-- that's a secondhand read of an old comment, not something re-verified
-- here, and teacher_attendance's current policies aren't visible from any
-- file in this repo at all. Rather than guess and risk either a silent
-- permission-denied on save or, worse, assuming a restriction exists that
-- doesn't, this adds a new, explicitly-scoped, independently-sufficient
-- UPDATE policy to each table. Postgres ORs every matching permissive
-- policy together, so this is purely additive -- it can't loosen or break
-- whatever's already there, including the admin-rework flow, which keeps
-- working exactly as before.
--
-- Scope: a teacher (or assistant) can update an attendance/teacher_attendance
-- row for any class they're actually linked to via class_teachers -- same
-- ownership check already used by the insert policy above -- with no
-- needs_rework requirement and no date restriction at the database level.
-- The date restriction is enforced at the application level instead: the
-- only place src/teacher.js ever calls this update path from is
-- renderAttendanceForm, which itself only ever renders for *today*
-- (renderActiveTab always passes today's date) -- there's no "Edit" button
-- anywhere on a past History entry, so there's no UI path that reaches a
-- historical date. Matches the same trust model 48's insert policy already
-- uses (app-enforced date, class-ownership-enforced by RLS) rather than
-- introducing a new one.
--
-- Run this against your Supabase project's SQL editor.

drop policy if exists "teachers self-edit their class attendance" on attendance;

create policy "teachers self-edit their class attendance"
  on attendance for update
  using (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  )
  with check (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "teachers self-edit their class teacher_attendance" on teacher_attendance;

create policy "teachers self-edit their class teacher_attendance"
  on teacher_attendance for update
  using (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  )
  with check (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

-- Confirm: both new policies should show up here, one per table, alongside
-- whatever UPDATE policies already existed (admins-manage-everything, and
-- the original rework policy if it's still separately named).
select tablename, policyname, cmd, qual, with_check
from pg_policies
where tablename in ('attendance', 'teacher_attendance') and cmd = 'UPDATE'
order by tablename, policyname;
