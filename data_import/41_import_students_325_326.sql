-- New student registrations: #325 Sathvik Pennam, #326 Kireeti Sarvigari.
-- class_id looked up by grade name so this doesn't depend on hardcoded
-- UUIDs. Safe to re-run: on conflict (registration_number) do nothing.

insert into students (
  registration_number, registration_week, full_name, preferred_name,
  grade_level, class_id, primary_parent_name, primary_parent_phone,
  primary_parent_email
) values
  (325, 'July 17', 'Sathvik Pennam', 'Sathvik', '9th Grade',
   (select id from classes where name = '9th Grade'),
   'Satya', '(636) 541-3060', 'satyarampennam@gmail.com'),
  (326, 'July 16', 'Kireeti Sarvigari', 'Kireeti', '4th Grade',
   (select id from classes where name = '4th Grade'),
   'Sandeep Reddy Sarvigari', '(636) 448-7923', 'skireeti15@gmail.com')
on conflict (registration_number) do nothing;

-- Confirm both rows landed correctly
select registration_number, full_name, grade_level, class_id
from students
where registration_number in (325, 326);
