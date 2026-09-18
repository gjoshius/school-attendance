-- Registers the current 12th-grade roster in teacher_registrations so
-- they're eligible to be assigned the Assistant role from the admin
-- dashboard's Classes tab (see 50_assistant_role.sql). This only makes
-- them selectable in that tab's teacher pool -- it does not assign them to
-- any class or create a login by itself. After running this:
--   1. Go to the admin Classes tab -- each of these nine now appears
--      twice in the "Assign Teachers" pool, once as themselves (Teacher)
--      and once labeled "(assistant, pending)".
--   2. Drag/assign the "(assistant, pending)" copy onto whichever class
--      they'll help with.
--   3. Have them self-signup at the login screen ("New teacher? Set up
--      your account") using the SAME email used below -- that's what
--      creates their profiles row with role = 'assistant' and their
--      class_teachers row, automatically, via the signup trigger.
--
-- Roster confirmed live via the admin's Students tab (grade_level =
-- '12th Grade') on 2026-09-18 -- nine students, all currently ungraded
-- for volunteer status. Emails supplied by the admin directly (students
-- aren't tracked with their own email anywhere in this schema).
--
-- Two of the nine look worth double-checking before running this --
-- KAUSHIKPALVAI@GMAI.COM (gmai.com, not gmail.com) and
-- SHPDESHPANDE@GMAIL.COM (doesn't obviously match "Isha Deshpande" the
-- way the other seven match their own names) -- if either is a typo, this
-- insert will still succeed, but that person won't be able to self-signup
-- with an email that doesn't exist, or the signup trigger won't find a
-- matching registration for the email they do use.

insert into teacher_registrations (email, full_name)
values
  ('arya.abhinavsundar@gmail.com', 'Arya Abhinavsundar'),
  ('devikaeluru45@gmail.com', 'Devika Eluru'),
  ('hrushikesheluru83@gmail.com', 'Hrushikesh Eluru'),
  ('SHPDESHPANDE@GMAIL.COM', 'ISHA DESHPANDE'),
  ('KAUSHIKPALVAI@gmail.COM', 'Kaushik Reddy Palavayi'),
  ('uomswaroop@gmail.com', 'Omswaroop Uppara'),
  ('sahasramu@gmail.com', 'Sahasra Muddu'),
  ('sudeepsenthils@gmail.com', 'Sudeep Senthil Murugan'),
  ('Uma.narayanan1643@gmail.com', 'Uma Narayanan')
on conflict (email) do nothing;

-- Confirm: should return all nine (or fewer, if any email was already
-- registered and got skipped by the ON CONFLICT above).
select email, full_name
from teacher_registrations
where full_name in (
  'Arya Abhinavsundar', 'Devika Eluru', 'Hrushikesh Eluru', 'ISHA DESHPANDE',
  'Kaushik Reddy Palavayi', 'Omswaroop Uppara', 'Sahasra Muddu',
  'Sudeep Senthil Murugan', 'Uma Narayanan'
)
order by full_name;
