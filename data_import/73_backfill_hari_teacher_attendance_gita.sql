-- Fixes a gap left by the earlier Gita backfills this session
-- (65_backfill_gita_attendance_20260912.sql / 70_backfill_gita_attendance_20260919.sql):
-- those only ever inserted STUDENT attendance rows for 2026-09-12 and
-- 2026-09-19 -- Hari (the Gita class's teacher) never had his own
-- teacher_attendance row created for either date, because he's the one
-- who never submitted the form in the first place (that's the whole
-- reason those two days needed backfilling). The Records tab's "Teacher
-- Attendance" section for those two dates has been missing him entirely
-- as a result, even though the class clearly happened (students were
-- marked present) and he was the one running it.
--
-- This inserts his teacher_attendance row as 'present' for both dates --
-- same "his class happened, he was there" reasoning as every other
-- backfill this session. Matched by name within Gita's own
-- class_teachers link (not a bare name search across all profiles) so
-- this can't accidentally match some other "Hari" elsewhere in the
-- system, with the same ambiguity guard (skip if more than one match)
-- and idempotency guard (skip if a row already exists) used throughout
-- this session's other backfill files.

-- STEP 1: sanity check -- should show exactly one teacher, and it should
-- be Hari. If this shows zero rows, more than one row, or the wrong
-- person, stop here and don't run STEP 2 -- reply with what this shows
-- instead.
select p.id as teacher_id, p.full_name, c.id as class_id, c.name as class_name
from class_teachers ct
join profiles p on p.id = ct.teacher_id
join classes c on c.id = ct.class_id
where c.name = 'Gita' and p.full_name ilike '%hari%';

-- STEP 2: the actual insert -- self-contained, safe to re-run. Skips
-- entirely (no error) if STEP 1's match isn't exactly one teacher, and
-- skips per-date if a teacher_attendance row for that date already
-- exists (e.g. if this is run twice, or someone submits it through the
-- app's new Backfill Attendance panel first).
insert into teacher_attendance (teacher_id, class_id, date, status, marked_by)
select ct.teacher_id, ct.class_id, d.date, 'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from class_teachers ct
join profiles p on p.id = ct.teacher_id
join classes c on c.id = ct.class_id
cross join (values (date '2026-09-12'), (date '2026-09-19')) as d(date)
where c.name = 'Gita'
  and p.full_name ilike '%hari%'
  and (
    select count(*)
    from class_teachers ct2
    join profiles p2 on p2.id = ct2.teacher_id
    join classes c2 on c2.id = ct2.class_id
    where c2.name = 'Gita' and p2.full_name ilike '%hari%'
  ) = 1
  and not exists (
    select 1 from teacher_attendance ta
    where ta.teacher_id = ct.teacher_id
      and ta.class_id = ct.class_id
      and ta.date = d.date
  );

-- STEP 3: confirm -- should show Hari, 'present', for both 2026-09-12 and
-- 2026-09-19.
select p.full_name, ta.date, ta.status
from teacher_attendance ta
join profiles p on p.id = ta.teacher_id
where ta.class_id = (select id from classes where name = 'Gita')
  and ta.date in (date '2026-09-12', date '2026-09-19')
order by ta.date;
