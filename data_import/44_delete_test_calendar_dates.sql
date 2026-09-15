-- Clean up the 6 "test"/"Test" labeled Calendar dates (used only for
-- testing before the program's actual first class on 2026-09-12), plus
-- every attendance / teacher-attendance / lesson-note row logged against
-- them. Orientation (08-29) and Labor Day Holiday (09-05) are deliberately
-- left alone -- they're kept as legitimate calendar history.
--
-- Scoped to these exact 6 dates (not "everything before 09-12") so
-- Orientation/Labor Day are never touched even though they also fall
-- before that cutoff. Safe to re-run: every delete below is a no-op once
-- the rows are already gone.

-- Student attendance logged on the test dates (62 rows expected)
delete from attendance
where date in ('2026-08-26', '2026-08-27', '2026-08-31', '2026-09-07', '2026-09-08', '2026-09-09');

-- Teacher attendance logged on the test dates (4 rows expected)
delete from teacher_attendance
where date in ('2026-08-26', '2026-08-27', '2026-08-31', '2026-09-07', '2026-09-08', '2026-09-09');

-- Lesson notes logged on the test dates (0 rows expected, included for completeness)
delete from class_lesson_notes
where date in ('2026-08-26', '2026-08-27', '2026-08-31', '2026-09-07', '2026-09-08', '2026-09-09');

-- The 6 "test"/"Test" Calendar entries themselves, by id (so this can
-- never accidentally match a future date someone relabels "test")
delete from class_sessions
where id in (
  'fd82fb9a-40bf-4ab4-9a82-b48848bacd77', -- 2026-08-26 test
  '09407edf-2888-4999-b860-16077cfd420d', -- 2026-08-27 test
  'dc5d21a7-ffba-4dc3-b803-4273736442d2', -- 2026-08-31 test
  '1c71b286-8b0b-4fd6-aa0a-a1856b42c115', -- 2026-09-07 test
  '13e180ae-7ad7-4309-82d7-050d9b6b52af', -- 2026-09-08 Test
  '50b8422b-5f57-420c-aba9-16ccaaa98804'  -- 2026-09-09 test
);

-- Confirm: all four should return 0 rows
select count(*) as remaining_attendance from attendance
where date in ('2026-08-26', '2026-08-27', '2026-08-31', '2026-09-07', '2026-09-08', '2026-09-09');

select count(*) as remaining_teacher_attendance from teacher_attendance
where date in ('2026-08-26', '2026-08-27', '2026-08-31', '2026-09-07', '2026-09-08', '2026-09-09');

select count(*) as remaining_lesson_notes from class_lesson_notes
where date in ('2026-08-26', '2026-08-27', '2026-08-31', '2026-09-07', '2026-09-08', '2026-09-09');

select count(*) as remaining_test_sessions from class_sessions
where id in (
  'fd82fb9a-40bf-4ab4-9a82-b48848bacd77',
  '09407edf-2888-4999-b860-16077cfd420d',
  'dc5d21a7-ffba-4dc3-b803-4273736442d2',
  '1c71b286-8b0b-4fd6-aa0a-a1856b42c115',
  '13e180ae-7ad7-4309-82d7-050d9b6b52af',
  '50b8422b-5f57-420c-aba9-16ccaaa98804'
);

-- Confirm Orientation and Labor Day Holiday are still there, untouched
select session_date, label, day_type, is_attendance_day
from class_sessions
where session_date in ('2026-08-29', '2026-09-05')
order by session_date;
