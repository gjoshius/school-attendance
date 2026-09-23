-- Follow-up to 78_backfill_bhajan_attendance_20260912.sql: Hari's 9/19
-- message resolved two of the four names that were ambiguous on 9/12 (see
-- 79_diagnose_bhajan_20260919_names.sql's notes for the reasoning):
--   - "Aradhya" was Aaradhya Kandala (5th Grade), not Aaradhya Adabala.
--   - "Sriyan" was Shriyan Reddy Katipalli (4th Grade), not Sriyan Varma
--     Alluri.
--
-- 78 defaulted both to absent since they were still unresolved at the
-- time. This flips just those two rows to present for 2026-09-12.
-- Written to work correctly whether or not 78 has already been run:
-- updates the row in place if 78 already inserted it as absent, or
-- inserts it fresh as present if 78 hasn't run yet (or ran with these two
-- excluded for some other reason). Either way, safe to re-run.
--
-- Still open from 9/12: Sai, Vihaan (still ambiguous), and Priyanka,
-- Varsha, Avnathika, Aarya (still not found) -- unaffected by this file.

update attendance
set status = 'present'
where class_id = (select id from classes where name = 'Bhajan')
  and date = date '2026-09-12'
  and student_id in (
    '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', -- Aaradhya Kandala
    'e5dfa080-24c9-43aa-9ec4-daa9b30763a8'  -- Shriyan Reddy Katipalli
  );

insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-12',
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.id in (
  '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', -- Aaradhya Kandala
  'e5dfa080-24c9-43aa-9ec4-daa9b30763a8'  -- Shriyan Reddy Katipalli
)
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Bhajan')
    and a.date = date '2026-09-12'
);

-- Confirm: both should now show 'present' for 2026-09-12.
select p.full_name, a.status
from attendance a
join students p on p.id = a.student_id
where a.class_id = (select id from classes where name = 'Bhajan')
  and a.date = date '2026-09-12'
  and a.student_id in (
    '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f',
    'e5dfa080-24c9-43aa-9ec4-daa9b30763a8'
  );
