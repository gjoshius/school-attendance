-- Confirmed: Hari Kavuri (teacher_id a079e22e-588d-4cb6-bd6b-dea4bc84fdaf)
-- is linked to Bhajan via class_teachers (along with 9th/10th/11th Grade
-- homerooms) -- see the broader name search that surfaced this. Using his
-- id directly here rather than matching by name again, since it's already
-- unambiguous.
--
-- Same gap as every other case this session: he ran Bhajan class on both
-- Saturdays but never submitted through the app, so his own
-- teacher_attendance row for 2026-09-12 and 2026-09-19 never got created.
-- This inserts it as 'present' for both dates. Idempotent -- safe to
-- re-run, and skips a date if a row already exists for it (e.g. if it's
-- since been entered through the app's new Backfill Attendance panel).
--
-- Note: this only fixes his OWN teacher attendance. It does not touch
-- Bhajan's student attendance for these two dates -- if that also needs
-- backfilling (i.e. nobody's Bhajan attendance was recorded at all for
-- 9/12 and/or 9/19, not just Hari's), that needs the actual per-student
-- roster for those two days first, the same way the Gita gap earlier this
-- session needed the paper sign-in sheets before anything could be
-- entered -- happy to do that too if you have who attended.

insert into teacher_attendance (teacher_id, class_id, date, status, marked_by)
select
  'a079e22e-588d-4cb6-bd6b-dea4bc84fdaf',
  (select id from classes where name = 'Bhajan'),
  d.date,
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from (values (date '2026-09-12'), (date '2026-09-19')) as d(date)
where not exists (
  select 1 from teacher_attendance ta
  where ta.teacher_id = 'a079e22e-588d-4cb6-bd6b-dea4bc84fdaf'
    and ta.class_id = (select id from classes where name = 'Bhajan')
    and ta.date = d.date
);

-- Confirm: should show Hari Kavuri, 'present', for both 2026-09-12 and
-- 2026-09-19.
select p.full_name, ta.date, ta.status
from teacher_attendance ta
join profiles p on p.id = ta.teacher_id
where ta.class_id = (select id from classes where name = 'Bhajan')
  and ta.date in (date '2026-09-12', date '2026-09-19')
order by ta.date;
