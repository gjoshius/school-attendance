-- One consolidated script for both missed Bhajan Saturdays -- replaces
-- 78 and 80 (neither of those has been run yet, so this supersedes both
-- rather than layering on top of them). Covers everything currently
-- resolvable for 2026-09-12 and 2026-09-19; still-open names for either
-- date are listed below and are deliberately left out rather than
-- guessed -- this session has already caught two wrong-row mistakes from
-- exactly that kind of guess (Sanvitha Sree's dropped surname, the
-- Nandhakishore/Navhakishore near-duplicate).
--
-- Every student currently on the Bhajan roster (students.optional_class
-- = 'bhajan') gets exactly one row per date: 'present' for the names
-- matched below, 'absent' for everyone else on the roster (including the
-- still-ambiguous names, until they're resolved). All four inserts below
-- are self-contained and idempotent -- safe to run as one script, and
-- safe to re-run later once the open items are resolved (a later fix
-- just flips the specific row from absent to present).
--
-- STILL OPEN -- not included as present anywhere below:
--   2026-09-12: Sai (3 candidates), Vihaan (2 candidates), and Priyanka,
--     Varsha, Avnathika, Aarya (no match on the roster at all).
--   2026-09-19: Vihaan (same 2 candidates), Charvi (2 candidates:
--     Charvi Kalisetti 8th or Charvi Yamala 1st), Aarya (no last name,
--     no match), and Agatha Kallepu / Priyanka Mulukutla / Sai Manikyala
--     / Srikar Koukuntla / Krish Koukuntla -- none of these five are on
--     the Bhajan roster at all (see 79_diagnose_bhajan_20260919_names.sql,
--     not yet run -- still worth running to check if they're enrolled
--     under a different/blank optional_class, same as the earlier Gita gap).
--
-- RESOLVED since the last message: 9/19's fuller names ("Aradhya
-- Kandala", "Sriyan Katipalli") confirm what 9/12's bare first names
-- meant, so both dates use the same identification for these two:
--   - Aradhya -> Aaradhya Kandala (5th Grade), not Aaradhya Adabala
--   - Sriyan  -> Shriyan Reddy Katipalli (4th Grade), not Sriyan Varma Alluri

-- ============================================================
-- 2026-09-12 -- present (12 confirmed names)
-- ============================================================
insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-12',
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.id in (
  'bdc38123-2387-4839-93ee-3399e069f282', -- Akshaya Kandala
  '21ee5c4e-af42-449f-b823-0f70c4b05569', -- Dakshith Pandilla
  '5cd5c284-eac2-414c-8281-f03dd4a3b008', -- Deethya kondapalli
  '3a9f456c-8b26-44bb-a40e-1166373c643b', -- gowtham dasam
  'fcf20f1c-8b1e-4585-bbc8-1adf63ae9050', -- Ishanvi reddy dongale
  '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe', -- Laasya Korrapati
  'e436a189-8af3-454a-9f05-9055b1230773', -- Saanvi Matharasi
  'be8e893d-3fc3-4561-8209-bd73f2785b84', -- Saharsh Kandukuri
  'fc5f1cee-1128-4b7e-9ac4-3912587a4094', -- Samritha Batchu
  '2e566927-64f3-4360-9802-1ad63726af6b', -- Veronica Sahu
  '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', -- Aaradhya Kandala
  'e5dfa080-24c9-43aa-9ec4-daa9b30763a8'  -- Shriyan Reddy Katipalli
)
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Bhajan')
    and a.date = date '2026-09-12'
);

-- ============================================================
-- 2026-09-12 -- absent (rest of the Bhajan roster)
-- ============================================================
insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-12',
  'absent',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.optional_class = 'bhajan'
  and s.id not in (
    'bdc38123-2387-4839-93ee-3399e069f282',
    '21ee5c4e-af42-449f-b823-0f70c4b05569',
    '5cd5c284-eac2-414c-8281-f03dd4a3b008',
    '3a9f456c-8b26-44bb-a40e-1166373c643b',
    'fcf20f1c-8b1e-4585-bbc8-1adf63ae9050',
    '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe',
    'e436a189-8af3-454a-9f05-9055b1230773',
    'be8e893d-3fc3-4561-8209-bd73f2785b84',
    'fc5f1cee-1128-4b7e-9ac4-3912587a4094',
    '2e566927-64f3-4360-9802-1ad63726af6b',
    '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f',
    'e5dfa080-24c9-43aa-9ec4-daa9b30763a8'
  )
  and not exists (
    select 1 from attendance a
    where a.student_id = s.id
      and a.class_id = (select id from classes where name = 'Bhajan')
      and a.date = date '2026-09-12'
  );

-- ============================================================
-- 2026-09-19 -- present (11 confirmed names)
-- ============================================================
insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-19',
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.id in (
  'bdc38123-2387-4839-93ee-3399e069f282', -- Akshaya Kandala
  '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe', -- Laasya Korrapati (lasya)
  '1bcc3573-98dc-4f5f-abcf-17ca70e93afd', -- Vedant Sahu (Vedanth)
  '21ee5c4e-af42-449f-b823-0f70c4b05569', -- Dakshith Pandilla
  '3a9f456c-8b26-44bb-a40e-1166373c643b', -- gowtham dasam (Gouwtham)
  'e5dfa080-24c9-43aa-9ec4-daa9b30763a8', -- Shriyan Reddy Katipalli (Sriyan Katipalli)
  'e436a189-8af3-454a-9f05-9055b1230773', -- Saanvi Matharasi
  '5cd5c284-eac2-414c-8281-f03dd4a3b008', -- Deethya kondapalli (Deetya Kondapalli)
  '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', -- Aaradhya Kandala (Aradhya Kandala)
  'ae289f41-612b-4022-b6cd-cf0dbf74e5d8', -- SRIVARSHITHA LAVU (Srivarshitha Lavu)
  'be8e893d-3fc3-4561-8209-bd73f2785b84'  -- Saharsh Kandukuri
)
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Bhajan')
    and a.date = date '2026-09-19'
);

-- ============================================================
-- 2026-09-19 -- absent (rest of the Bhajan roster)
-- ============================================================
insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-19',
  'absent',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.optional_class = 'bhajan'
  and s.id not in (
    'bdc38123-2387-4839-93ee-3399e069f282',
    '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe',
    '1bcc3573-98dc-4f5f-abcf-17ca70e93afd',
    '21ee5c4e-af42-449f-b823-0f70c4b05569',
    '3a9f456c-8b26-44bb-a40e-1166373c643b',
    'e5dfa080-24c9-43aa-9ec4-daa9b30763a8',
    'e436a189-8af3-454a-9f05-9055b1230773',
    '5cd5c284-eac2-414c-8281-f03dd4a3b008',
    '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f',
    'ae289f41-612b-4022-b6cd-cf0dbf74e5d8',
    'be8e893d-3fc3-4561-8209-bd73f2785b84'
  )
  and not exists (
    select 1 from attendance a
    where a.student_id = s.id
      and a.class_id = (select id from classes where name = 'Bhajan')
      and a.date = date '2026-09-19'
  );

-- ============================================================
-- Confirm: counts by date/status. Bhajan's roster has 65 students, so
-- each date should total 65 (present + absent).
--   2026-09-12: 12 present, 53 absent
--   2026-09-19: 11 present, 54 absent
-- ============================================================
select date, status, count(*)
from attendance
where class_id = (select id from classes where name = 'Bhajan')
  and date in (date '2026-09-12', date '2026-09-19')
group by date, status
order by date, status;
