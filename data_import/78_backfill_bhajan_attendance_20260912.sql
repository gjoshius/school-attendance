-- Backfills Bhajan attendance for 2026-09-12 from the two group lists (18
-- first names). Matched by exact student id against the full Bhajan
-- roster (see 77_get_bhajan_roster.sql's results) rather than by name --
-- first names alone were NOT safe to match automatically here:
--
--   * 4 names have no match anywhere on the Bhajan roster at all:
--     Priyanka, Varsha, Avnathika, Aarya.
--   * 4 names match more than one roster student, so which one actually
--     attended is genuinely ambiguous:
--       - Aradhya -> AARADHYA ADABALA (1st Grade) or Aaradhya Kandala (5th Grade)
--       - Sai     -> Sai Mayukha Aakula (8th), Sai Saanvika Karampudi (3rd), or Sai Saranya (2nd)
--       - Sriyan  -> Sriyan Varma Alluri (3rd) -- or did you mean Shriyan Reddy Katipalli (4th)?
--       - Vihaan  -> Vihaan Krishna Reddy Gadikota (K) or Vihaan Sai Ramgopal (1st)
--
-- Those 8 are NOT included as present below -- marking any of them
-- present on a guess risks exactly the wrong-row mistake this session has
-- already caught twice (Sanvitha Sree's dropped surname, the
-- Nandhakishore/Navhakishore near-duplicate). They default to absent
-- along with the rest of the roster for now; once you confirm which exact
-- student each one is (full name, or just grade level is enough to pick
-- from the options above), a small follow-up UPDATE flips just those rows
-- to present -- same pattern as Divisha/Sanvitha Sree's own follow-up
-- fixes earlier this session.
--
-- The other 10 names matched exactly one roster student each and are
-- inserted as present. Everyone else on the Bhajan roster (including the
-- 8 unresolved above) is inserted as absent, so every enrolled Bhajan
-- student ends up with exactly one row for this date -- same "every
-- roster student gets a row" convention as every other backfill this
-- session. Both inserts are self-contained and idempotent.

-- Present: the 10 unambiguous matches.
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
  '2e566927-64f3-4360-9802-1ad63726af6b'  -- Veronica Sahu
)
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Bhajan')
    and a.date = date '2026-09-12'
);

-- Absent: every other Bhajan-roster student for this date, including the
-- 8 unresolved names above until they're confirmed.
insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-12',
  'absent',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.optional_class = 'bhajan'
  and s.id not in (
    'bdc38123-2387-4839-93ee-3399e069f282', -- Akshaya Kandala
    '21ee5c4e-af42-449f-b823-0f70c4b05569', -- Dakshith Pandilla
    '5cd5c284-eac2-414c-8281-f03dd4a3b008', -- Deethya kondapalli
    '3a9f456c-8b26-44bb-a40e-1166373c643b', -- gowtham dasam
    'fcf20f1c-8b1e-4585-bbc8-1adf63ae9050', -- Ishanvi reddy dongale
    '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe', -- Laasya Korrapati
    'e436a189-8af3-454a-9f05-9055b1230773', -- Saanvi Matharasi
    'be8e893d-3fc3-4561-8209-bd73f2785b84', -- Saharsh Kandukuri
    'fc5f1cee-1128-4b7e-9ac4-3912587a4094', -- Samritha Batchu
    '2e566927-64f3-4360-9802-1ad63726af6b'  -- Veronica Sahu
  )
  and not exists (
    select 1 from attendance a
    where a.student_id = s.id
      and a.class_id = (select id from classes where name = 'Bhajan')
      and a.date = date '2026-09-12'
  );

-- Confirm: counts by status, should be 10 present + 55 absent = 65 total
-- (the full Bhajan roster).
select status, count(*)
from attendance
where class_id = (select id from classes where name = 'Bhajan')
  and date = date '2026-09-12'
group by status
order by status;
