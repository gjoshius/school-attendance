-- Backfills the 4 students from the very first report this session
-- ("names not present in digital chart but came today to GITA class") for
-- the actual date in question, 2026-09-19. All 4 were present (that's what
-- prompted the report), matched by registration_number to avoid any name
-- ambiguity:
--   21  -- Deetya Sri Kadiyala (5th Grade)
--   165 -- Vihaan Vennu        (8th Grade)
--   166 -- Sudheeksha Vennu    (4th Grade)
--   325 -- Sathvik Pennam      (9th Grade)
--
-- Divisha Chintu is deliberately NOT included -- she was only confirmed
-- present on the 9/12 paper sheet (see 69_divisha_gita_and_attendance.sql);
-- it's unconfirmed whether she also attended on 9/19. Add her separately
-- if/when that's confirmed.
--
-- This uses a direct insert rather than the app's "Edit Attendance"
-- feature, because if attendance for 9/19 was already submitted before
-- these 4 had optional_class = 'gita' set, the app's self-edit save used
-- to silently fail to record a student with no prior row for that date
-- (see src/teacher.js's renderAttendanceForm doc comment -- fixed this
-- session, but this file avoids relying on it for backfilling data from
-- before the fix). Safe to re-run: skips any of the 4 that already has an
-- attendance row for this date (e.g. if the fixed self-edit feature is
-- used for one of them before this runs).

insert into attendance (student_id, class_id, date, status, marked_by)
select
  s.id,
  (select id from classes where name = 'Gita'),
  date '2026-09-19',
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.registration_number in (21, 165, 166, 325)
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Gita')
    and a.date = date '2026-09-19'
);

-- Confirm: should show all 4, each present, for 2026-09-19.
select s.registration_number, s.full_name, a.status, a.date
from attendance a
join students s on s.id = a.student_id
where a.class_id = (select id from classes where name = 'Gita')
  and a.date = date '2026-09-19'
order by s.registration_number;
