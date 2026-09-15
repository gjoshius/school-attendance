-- Mark 7 students present for the September 12, 2026 class (the last class
-- held). Uses each student's current class_id from the students table.
-- Idempotent: deletes any existing attendance rows for these students on
-- this date first, then inserts fresh ones, so it's safe to re-run.

delete from attendance
where date = '2026-09-12'
  and student_id in (
    '4cce5a7e-88c7-4571-afa1-1c119d371f2f', -- 217 Charani Nalluri
    '2dc3fcc4-115a-4f05-9628-b4597f136310', -- 259 Nivedh Banda
    'a36d4fd9-0536-4fd3-bba2-bc7b50220116', -- 322 Indira Kothapalli
    '0a2b9baf-7241-416e-bd7c-830aaa84c5a6', -- 323 Anshika Chinthaluri
    '3589bcf3-d849-415c-97cd-9af03e2b89d7', -- 324 Priyanka Mulukutla
    '9343c12d-4568-42d1-bda5-6c44c21c6e81', -- 325 Sathvik Pennam
    '2e7149c4-7d90-46d9-9545-00848a02a2c2'  -- 326 Kireeti Sarvigari
  );

insert into attendance (student_id, class_id, date, status, marked_by, needs_rework)
values
  ('4cce5a7e-88c7-4571-afa1-1c119d371f2f', '1a8a9cae-56d8-4308-a219-af2b492dbc07', '2026-09-12', 'present', 'af92c181-2e0f-45da-88b7-b17e80afa1d9', false), -- 217 Charani Nalluri
  ('2dc3fcc4-115a-4f05-9628-b4597f136310', 'fc8a7e99-96f6-49d7-8fb4-717ee4826412', '2026-09-12', 'present', 'af92c181-2e0f-45da-88b7-b17e80afa1d9', false), -- 259 Nivedh Banda
  ('a36d4fd9-0536-4fd3-bba2-bc7b50220116', '85774851-8539-43a6-b97b-ae3c5d609f90', '2026-09-12', 'present', 'af92c181-2e0f-45da-88b7-b17e80afa1d9', false), -- 322 Indira Kothapalli
  ('0a2b9baf-7241-416e-bd7c-830aaa84c5a6', '85774851-8539-43a6-b97b-ae3c5d609f90', '2026-09-12', 'present', 'af92c181-2e0f-45da-88b7-b17e80afa1d9', false), -- 323 Anshika Chinthaluri
  ('3589bcf3-d849-415c-97cd-9af03e2b89d7', '88971746-d3f4-45de-920c-a36417b867ad', '2026-09-12', 'present', 'af92c181-2e0f-45da-88b7-b17e80afa1d9', false), -- 324 Priyanka Mulukutla
  ('9343c12d-4568-42d1-bda5-6c44c21c6e81', 'fc8a7e99-96f6-49d7-8fb4-717ee4826412', '2026-09-12', 'present', 'af92c181-2e0f-45da-88b7-b17e80afa1d9', false), -- 325 Sathvik Pennam
  ('2e7149c4-7d90-46d9-9545-00848a02a2c2', '3f52e5a6-14ef-4761-a656-176cfa8f4182', '2026-09-12', 'present', 'af92c181-2e0f-45da-88b7-b17e80afa1d9', false); -- 326 Kireeti Sarvigari

-- Confirm all 7 rows landed correctly
select s.registration_number, s.full_name, a.date, a.status
from attendance a
join students s on s.id = a.student_id
where a.date = '2026-09-12'
  and s.registration_number in (217, 259, 322, 323, 324, 325, 326)
order by s.registration_number;
