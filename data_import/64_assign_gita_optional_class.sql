-- Sets optional_class = 'gita' for the 4 students confirmed this session as
-- regular Gita attendees who were missing from the digital Gita roster
-- (src/teacher.js builds that roster from students.optional_class = 'gita',
-- independent of grade/homeroom -- see format.js's OPTIONAL_CLASS_CODE_BY_NAME
-- doc comment). Confirmed via 62_check_gita_missing_students.sql and
-- 63_check_sathvik_duplicate.sql, and corroborated by last Saturday's paper
-- sign-in sheets, where 3 of these 4 were already handwritten in as walk-ins
-- not on the printed roster.
--
-- Matched by registration_number, not name, since that's the one column
-- guaranteed unique and already confirmed correct for each of these four
-- earlier this session:
--   21  -- Deetya Sri Kadiyala (5th Grade) -- was 'bhajan', now moving to 'gita'
--   165 -- Vihaan Vennu        (8th Grade) -- was null
--   166 -- Sudheeksha Vennu    (4th Grade) -- was null (paper sheet spells her "Sudeeshra")
--   325 -- Sathvik Pennam      (9th Grade) -- was null
--
-- Deetya is the only one of the four actively changing FROM a different
-- value ('bhajan') rather than filling in a blank -- confirmed with Gaurav
-- directly that all four should be 'gita', not just the three that were
-- previously unset.
--
-- "Divisha" (5th Grade, also handwritten on last week's sheet) is
-- deliberately NOT included here -- her full name/registration record
-- hasn't been confirmed yet, to fix separately once identified.

update students
set optional_class = 'gita'
where registration_number in (21, 165, 166, 325);

-- Confirm: all four should now show optional_class = 'gita'.
select registration_number, full_name, grade_level, optional_class
from students
where registration_number in (21, 165, 166, 325)
order by registration_number;
