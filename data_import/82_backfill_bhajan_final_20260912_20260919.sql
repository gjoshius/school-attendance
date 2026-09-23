-- Final, fully self-contained backfill for both Bhajan Saturdays.
-- Supersedes 78, 80, and 81 -- none of those need to be run; this alone
-- covers everything currently resolved for 2026-09-12 and 2026-09-19.
-- Safe to run regardless of whether any earlier file was already run
-- (each present/absent write below is an UPDATE-if-exists-then-
-- INSERT-if-still-missing, so a prior partial run is picked up correctly
-- rather than skipped), and safe to re-run this file itself.
--
-- STEP 1: five students were filed under the wrong optional_class (or
-- none at all), which is why they never showed up on the Bhajan roster
-- in the first place -- same category of gap as the Gita cases earlier
-- this session (Deetya Sri Kadiyala, Divisha Chintu, etc). Fixing this
-- puts them on Bhajan's LIVE roster going forward, not just this
-- backfill. Two of them (Aarya Kode, Sai Manvitha Manikyala) were
-- previously filed under Gita -- this removes them from Gita's roster
-- going forward, since a student is only ever in one optional class. Not
-- touching Aarya Datar (stays Gita -- Aarya Kode was the one identified
-- as the Bhajan attendee) or Srikar Koukuntla (doesn't exist in the
-- system at all yet -- needs an actual new student record, separate from
-- this fix).
update students
set optional_class = 'bhajan'
where id in (
  'a6398fb5-4b11-4f30-8c0e-38eb93994884', -- Aarya Kode
  'da8e8078-52f6-444e-b735-223560a97a94', -- Agatha Kallepu
  'fd50ba1c-46e3-4f73-8360-ae457d3da7f3', -- Krish koukuntla
  '3589bcf3-d849-415c-97cd-9af03e2b89d7', -- Priyanka Mulukutla
  '7fdb6efc-77b2-4153-a797-f14ba02c2e3f'  -- Sai Manvitha Manikyala
);

-- STEP 2: 2026-09-12 -- present (16 confirmed names). UPDATE first
-- (flips an existing absent row, e.g. from an earlier partial run),
-- then INSERT anyone still missing a row entirely.
update attendance
set status = 'present'
where class_id = (select id from classes where name = 'Bhajan')
  and date = date '2026-09-12'
  and student_id in (
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
    'e5dfa080-24c9-43aa-9ec4-daa9b30763a8', -- Shriyan Reddy Katipalli
    '342c1e75-d152-448c-82ad-55d9070808c3', -- Vihaan Sai Ramgopal
    'a6398fb5-4b11-4f30-8c0e-38eb93994884', -- Aarya Kode
    '3589bcf3-d849-415c-97cd-9af03e2b89d7', -- Priyanka Mulukutla
    '7fdb6efc-77b2-4153-a797-f14ba02c2e3f'  -- Sai Manvitha Manikyala
  );

insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-12',
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.id in (
  'bdc38123-2387-4839-93ee-3399e069f282', '21ee5c4e-af42-449f-b823-0f70c4b05569',
  '5cd5c284-eac2-414c-8281-f03dd4a3b008', '3a9f456c-8b26-44bb-a40e-1166373c643b',
  'fcf20f1c-8b1e-4585-bbc8-1adf63ae9050', '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe',
  'e436a189-8af3-454a-9f05-9055b1230773', 'be8e893d-3fc3-4561-8209-bd73f2785b84',
  'fc5f1cee-1128-4b7e-9ac4-3912587a4094', '2e566927-64f3-4360-9802-1ad63726af6b',
  '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', 'e5dfa080-24c9-43aa-9ec4-daa9b30763a8',
  '342c1e75-d152-448c-82ad-55d9070808c3', 'a6398fb5-4b11-4f30-8c0e-38eb93994884',
  '3589bcf3-d849-415c-97cd-9af03e2b89d7', '7fdb6efc-77b2-4153-a797-f14ba02c2e3f'
)
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Bhajan')
    and a.date = date '2026-09-12'
);

-- STEP 3: 2026-09-19 -- present (18 confirmed names). Same
-- UPDATE-then-INSERT-if-missing pattern.
update attendance
set status = 'present'
where class_id = (select id from classes where name = 'Bhajan')
  and date = date '2026-09-19'
  and student_id in (
    'bdc38123-2387-4839-93ee-3399e069f282', -- Akshaya Kandala
    '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe', -- Laasya Korrapati
    '1bcc3573-98dc-4f5f-abcf-17ca70e93afd', -- Vedant Sahu
    '21ee5c4e-af42-449f-b823-0f70c4b05569', -- Dakshith Pandilla
    '3a9f456c-8b26-44bb-a40e-1166373c643b', -- gowtham dasam
    'e5dfa080-24c9-43aa-9ec4-daa9b30763a8', -- Shriyan Reddy Katipalli
    'e436a189-8af3-454a-9f05-9055b1230773', -- Saanvi Matharasi
    '5cd5c284-eac2-414c-8281-f03dd4a3b008', -- Deethya kondapalli
    '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', -- Aaradhya Kandala
    'ae289f41-612b-4022-b6cd-cf0dbf74e5d8', -- SRIVARSHITHA LAVU
    'be8e893d-3fc3-4561-8209-bd73f2785b84', -- Saharsh Kandukuri
    '342c1e75-d152-448c-82ad-55d9070808c3', -- Vihaan Sai Ramgopal
    'a6398fb5-4b11-4f30-8c0e-38eb93994884', -- Aarya Kode
    'bf118521-15ad-485f-996a-1ce45e822973', -- Charvi Yamala
    'da8e8078-52f6-444e-b735-223560a97a94', -- Agatha Kallepu
    'fd50ba1c-46e3-4f73-8360-ae457d3da7f3', -- Krish koukuntla
    '3589bcf3-d849-415c-97cd-9af03e2b89d7', -- Priyanka Mulukutla
    '7fdb6efc-77b2-4153-a797-f14ba02c2e3f'  -- Sai Manvitha Manikyala
  );

insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  date '2026-09-19',
  'present',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
where s.id in (
  'bdc38123-2387-4839-93ee-3399e069f282', '1acc9e8b-d7b7-4180-84ab-c5d9fc488fbe',
  '1bcc3573-98dc-4f5f-abcf-17ca70e93afd', '21ee5c4e-af42-449f-b823-0f70c4b05569',
  '3a9f456c-8b26-44bb-a40e-1166373c643b', 'e5dfa080-24c9-43aa-9ec4-daa9b30763a8',
  'e436a189-8af3-454a-9f05-9055b1230773', '5cd5c284-eac2-414c-8281-f03dd4a3b008',
  '13541302-c7cd-4d58-9cd4-7ffc6ed51b4f', 'ae289f41-612b-4022-b6cd-cf0dbf74e5d8',
  'be8e893d-3fc3-4561-8209-bd73f2785b84', '342c1e75-d152-448c-82ad-55d9070808c3',
  'a6398fb5-4b11-4f30-8c0e-38eb93994884', 'bf118521-15ad-485f-996a-1ce45e822973',
  'da8e8078-52f6-444e-b735-223560a97a94', 'fd50ba1c-46e3-4f73-8360-ae457d3da7f3',
  '3589bcf3-d849-415c-97cd-9af03e2b89d7', '7fdb6efc-77b2-4153-a797-f14ba02c2e3f'
)
and not exists (
  select 1 from attendance a
  where a.student_id = s.id
    and a.class_id = (select id from classes where name = 'Bhajan')
    and a.date = date '2026-09-19'
);

-- STEP 4: absent for everyone else now on the (updated, larger) Bhajan
-- roster, for both dates.
insert into attendance (student_id, class_id, date, status, marked_by)
select s.id,
  (select id from classes where name = 'Bhajan'),
  d.date,
  'absent',
  (select id from profiles where lower(email) = lower('gjoshius@gmail.com'))
from students s
cross join (values (date '2026-09-12'), (date '2026-09-19')) as d(date)
where s.optional_class = 'bhajan'
  and not exists (
    select 1 from attendance a
    where a.student_id = s.id
      and a.class_id = (select id from classes where name = 'Bhajan')
      and a.date = d.date
  );

-- Confirm: Bhajan's roster is now 70 students (65 + the 5 fixed in STEP
-- 1). 2026-09-12 should show 16 present / 54 absent; 2026-09-19 should
-- show 18 present / 52 absent.
select date, status, count(*)
from attendance
where class_id = (select id from classes where name = 'Bhajan')
  and date in (date '2026-09-12', date '2026-09-19')
group by date, status
order by date, status;
