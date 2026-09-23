-- Adds the new attendance_group column to students, and does an interim
-- assignment of Bhajan students to 'group1' / 'group2' based purely on the
-- two WhatsApp attendance messages Hari sent for 2026-09-12 and 2026-09-19
-- (the same messages already used in file 82's attendance backfill).
--
-- This is explicitly a PARTIAL, INTERIM assignment, not the definitive
-- roster split -- it only covers students who happened to be named as
-- present on one of those two Saturdays. Anyone on the Bhajan roster who
-- was absent both days, or never mentioned, is left ungrouped (NULL) on
-- purpose rather than guessed. The confirm query at the bottom lists them
-- so the gap stays visible; the plan is to replace this with the real
-- definitive Group 1 / Group 2 list once you get it from Hari/Sonia.
--
-- ONE NAME CONFLICT, left unresolved on purpose:
--   Saanvi Matharasi (e436a189-8af3-454a-9f05-9055b1230773) was listed
--   under "group1" on 9/12, but under the (unlabeled, assumed group2)
--   second list on 9/19. Since the two dates disagree, she is NOT assigned
--   to either group here -- she'll show up in the "ungrouped" list below.
--   Worth asking Hari/Sonia directly which group she's actually in.
--
-- Safe to re-run: the column-add and constraint are guarded, and the
-- UPDATEs just re-set the same values.

-- STEP 1: add the column (idempotent).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'students' and column_name = 'attendance_group'
  ) then
    alter table students add column attendance_group text;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'students_attendance_group_check'
  ) then
    alter table students
      add constraint students_attendance_group_check
      check (attendance_group in ('group1', 'group2'));
  end if;
end $$;

-- STEP 2: group1 -- union of both dates' "Group 1" lists, resolved to the
-- same student ids already verified in file 82 (Vihaan Sai Ramgopal,
-- Aarya Kode, Charvi Yamala confirmed/assumed per your earlier answers).
update students
set attendance_group = 'group1'
where id in (
  'fc5f1cee-1128-4b7e-9ac4-3912587a4094', -- Samritha Batchu
  'bdc38123-2387-4839-93ee-3399e069f282', -- Akshaya Kandala
  '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe', -- Laasya Korrapati
  'a6398fb5-4b11-4f30-8c0e-38eb93994884', -- Aarya Kode
  '342c1e75-d152-448c-82ad-55d9070808c3', -- Vihaan Sai Ramgopal
  '21ee5c4e-af42-449f-b823-0f70c4b05569', -- Dakshith Pandilla
  '2e566927-64f3-4360-9802-1ad63726af6b', -- Veronica Sahu
  '3a9f456c-8b26-44bb-a40e-1166373c643b', -- gowtham dasam
  'fcf20f1c-8b1e-4585-bbc8-1adf63ae9050', -- Ishanvi reddy dongale
  'bf118521-15ad-485f-996a-1ce45e822973', -- Charvi Yamala
  '1bcc3573-98dc-4f5f-abcf-17ca70e93afd'  -- Vedant Sahu
);

-- STEP 3: group2 -- union of both dates' "Group 2" lists, same resolved
-- ids as file 82.
update students
set attendance_group = 'group2'
where id in (
  'be8e893d-3fc3-4561-8209-bd73f2785b84', -- Saharsh Kandukuri
  '3589bcf3-d849-415c-97cd-9af03e2b89d7', -- Priyanka Mulukutla
  '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', -- Aaradhya Kandala
  '7fdb6efc-77b2-4153-a797-f14ba02c2e3f', -- Sai Manvitha Manikyala
  '5cd5c284-eac2-414c-8281-f03dd4a3b008', -- Deethya kondapalli
  'e5dfa080-24c9-43aa-9ec4-daa9b30763a8', -- Shriyan Reddy Katipalli
  'da8e8078-52f6-444e-b735-223560a97a94', -- Agatha Kallepu
  'ae289f41-612b-4022-b6cd-cf0dbf74e5d8', -- Srivarshitha Lavu
  'fd50ba1c-46e3-4f73-8360-ae457d3da7f3'  -- Krish koukuntla
);

-- CONFIRM 1: counts by group.
select attendance_group, count(*)
from students
where optional_class = 'bhajan'
group by attendance_group
order by attendance_group;

-- CONFIRM 2: everyone on the Bhajan roster still ungrouped -- includes
-- Saanvi Matharasi (the conflict above) and everyone never named in
-- either WhatsApp message. This list will need the real Group 1/2
-- assignment before grouping can work for the whole class.
select id, full_name, grade_level
from students
where optional_class = 'bhajan'
  and attendance_group is null
order by full_name;
