-- Follow-up for Divisha Chintu (registration_number 97, 5th Grade),
-- identified via 68_find_divisha.sql as the fourth confirmed Gita walk-in
-- from last Saturday's paper sign-in sheets. Same situation as Deetya Sri
-- Kadiyala (64_assign_gita_optional_class.sql): her optional_class was set
-- to 'bhajan', not 'gita', even though she's a regular Gita attendee.
--
-- Two changes, matched by registration_number to avoid any name-matching
-- risk:
--   1) optional_class: 'bhajan' -> 'gita', so she shows up on the app's
--      live Gita roster going forward.
--   2) Backfill her attendance for 2026-09-12 as 'present', completing
--      the set from 65_backfill_gita_attendance_20260912.sql /
--      67_backfill_sanvitha_gita_attendance.sql (that session now totals
--      80 students: 51 absent + 29 present).

update students
set optional_class = 'gita'
where registration_number = 97;

insert into attendance (student_id, class_id, date, status, marked_by)
select
  s.id,
  (select id from classes where name = 'Gita'),
  date '2026-09-12',
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.registration_number = 97
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Gita')
    and a.date = date '2026-09-12'
);

-- Confirm both changes landed.
select registration_number, full_name, grade_level, optional_class
from students
where registration_number = 97;

select count(*) as rows_inserted, status
from attendance
where class_id = (select id from classes where name = 'Gita')
  and date = date '2026-09-12'
group by status
order by status;
