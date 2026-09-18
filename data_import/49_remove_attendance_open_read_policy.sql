-- Removes public.attendance's "Authenticated read" policy (using (true)),
-- flagged the same way as "Authenticated insert" (fixed in
-- data_import/48_fix_attendance_insert_rls.sql): any signed-in user could
-- read every attendance row for every student, regardless of whether they
-- have any profiles row, role, or class assignment at all.
--
-- Confirmed live policy set on attendance before this change (via
-- select policyname, cmd, qual, with_check from pg_policies
-- where tablename = 'attendance'):
--   admins manage attendance              | ALL    | using: profiles.role = 'admin' for auth.uid()
--   Authenticated read                    | SELECT | using: true                        <-- removing this one
--   teachers view all attendance for ...  | SELECT | using: profiles.role = 'teacher' for auth.uid()
--   teachers rework their class attendance| UPDATE | using: class_id in (their class_teachers rows)
--   (Authenticated insert already fixed by 48_*.sql)
--
-- Unlike the INSERT fix, this one doesn't need a replacement policy: this
-- app only ever uses profiles.role = 'admin' or 'teacher' (confirmed via
-- grep across src/ -- no other role value appears anywhere), and those two
-- roles already have full SELECT coverage through the two policies above.
-- "admins manage attendance" is ALL (includes SELECT) for admins, and
-- "teachers view all attendance for volunteer eligibility" already
-- deliberately grants any teacher full read access to every student's
-- attendance, unscoped by class (see data_import/35's own comment on why).
-- So dropping "Authenticated read" doesn't take anything away from any
-- legitimate admin or teacher -- it only closes the gap for a signed-in
-- account that isn't actually either (e.g. one with no profiles row, or a
-- self-signup that was never pre-authorized by an admin).

drop policy if exists "Authenticated read" on attendance;

-- Confirm: "Authenticated read" should no longer appear, and admins/teachers
-- should be the only two ways left to SELECT from attendance.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'attendance'
order by cmd, policyname;
