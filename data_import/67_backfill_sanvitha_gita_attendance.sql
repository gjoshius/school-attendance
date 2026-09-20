-- Follow-up to 65_backfill_gita_attendance_20260912.sql: that file's STEP 2
-- flagged "Sanvitha Sree" (row 28, 6th Grade) as not matching any student.
-- Confirmed via 66_check_sanvitha_sree.sql -- her real database name is
-- "SANVITHA SREE SOMAVARAPU" (registration_number 243, 6th Grade); the
-- paper sheet just dropped her surname during transcription. Marked
-- absent (unchecked) on the printed roster for that Saturday.

insert into attendance (student_id, class_id, date, status, marked_by)
select
  s.id,
  (select id from classes where name = 'Gita'),
  date '2026-09-12',
  'absent',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.registration_number = 243
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Gita')
    and a.date = date '2026-09-12'
);

-- Confirm: all 79 paper-roster students (the original 78 matched + this
-- one) should now show up for 2026-09-12's Gita attendance -- 28 present,
-- 51 absent.
select count(*) as rows_inserted, status
from attendance
where class_id = (select id from classes where name = 'Gita')
  and date = date '2026-09-12'
group by status
order by status;
