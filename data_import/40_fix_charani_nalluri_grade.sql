-- Fix Charani Nalluri's grade_level: the database had her recorded as
-- "7th Grade", but the current master roster shows "8th Grade". Scoped to
-- her specific registration_number so this can't accidentally match anyone
-- else with a similar name.

update students
set grade_level = '8th Grade'
where registration_number = 217
  and lower(full_name) = lower('Charani Nalluri');

-- Confirm the update took effect
select registration_number, full_name, grade_level
from students
where registration_number = 217;
