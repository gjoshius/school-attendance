-- Lets any signed-in teacher read attendance history for any student, not
-- just the roster of a class they're personally assigned to. Needed for
-- the new attendance-percentage badges in the Log Hours tab (see
-- src/teacher.js's fetchAttendancePercentages) -- Log Hours already lets
-- any teacher log volunteer hours for any 6th-12th grade student
-- regardless of which class they teach (see VOLUNTEER_ELIGIBLE_GRADES in
-- src/format.js), so a teacher now needs to be able to check that same
-- student's attendance percentage too, to help decide whether to offer
-- them the opportunity.
--
-- `attendance` predates this repo's data_import scripts, so its original
-- policies aren't captured here (see
-- data_import/19_admin_attendance_management.sql's note) -- this adds a
-- teacher-facing read policy alongside whatever already exists. Safe to
-- re-run, and safe alongside any existing policy: Postgres evaluates every
-- matching permissive policy with OR, so this only ever adds read access,
-- never removes any.
--
-- Deliberately NOT scoped to "only this teacher's own class" the way
-- teacher_attendance's teacher policy is (data_import/18_teacher_attendance.sql)
-- -- a teacher already sees the full eligible-student roster (name + grade)
-- for every grade 6-12 student in the Log Hours tab regardless of class, so
-- this matches that same existing scope rather than introducing a new,
-- narrower one just for this one field. Admins already have full access
-- via data_import/19_admin_attendance_management.sql, unaffected by this.

drop policy if exists "teachers view all attendance for volunteer eligibility" on attendance;
create policy "teachers view all attendance for volunteer eligibility"
  on attendance for select
  using (exists (select 1 from profiles where id = auth.uid() and role = 'teacher'));
