-- Hari's 9/19 message resolves two of 9/12's open ambiguities (see
-- 78_backfill_bhajan_attendance_20260912.sql's notes):
--   - "Aradhya Kandala" confirms 9/12's "Aradhya" meant Aaradhya Kandala
--     (5th Grade), not Aaradhya Adabala (1st Grade).
--   - "Sriyan Katipalli" confirms 9/12's "Sriyan" meant Shriyan Reddy
--     Katipalli (4th Grade), not Sriyan Varma Alluri (3rd Grade).
-- (See 80_fix_bhajan_20260912_sriyan_aradhya.sql for that follow-up.)
--
-- But 9/19's own list raises new open items:
--   - "Charvi" (Group-1, first name only) matches two Bhajan-roster
--     students: CHARVI KALISETTI (8th Grade) and Charvi Yamala (1st
--     Grade) -- which one?
--   - "Vihaan" (Group-1, first name only) is the same unresolved
--     ambiguity as 9/12: Vihaan Krishna Reddy Gadikota (Kindergarten) or
--     Vihaan Sai Ramgopal (1st Grade)?
--   - "Aarya" (Group-1) -- still no last name, still no match on the
--     Bhajan roster.
--   - Four names from the second list aren't on the Bhajan roster at all:
--     Agatha Kallepu, Srikar Koukuntla, Krish Koukuntla, Priyanka
--     Mulukutla, and Sai Manikyala (five, not four -- listing all below).
--     This searches the WHOLE students table for each, not just Bhajan,
--     since the earlier Gita gap this session (Deetya/Vihaan
--     Vennu/Sudheeksha Vennu/Sathvik) turned out to be exactly this: real
--     enrolled students whose optional_class was blank or wrong, not
--     missing students. If any of these show up here with a different
--     (or no) optional_class, the fix is the same as before: correct
--     optional_class to 'bhajan', then backfill their attendance.

select id, registration_number, full_name, grade_level, class_id, optional_class
from students
where full_name ilike '%agatha%kallepu%'
   or full_name ilike '%srikar%koukuntla%'
   or full_name ilike '%krish%koukuntla%'
   or full_name ilike '%priyanka%mulukutla%'
   or full_name ilike '%sai%manikyala%'
   or full_name ilike 'aarya%'
order by full_name;
