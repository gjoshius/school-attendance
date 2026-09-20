-- Read-only diagnostic: registration_number 19 "Nandhakishore Rahul Nair"
-- and 20 "Navhakishore Rahul Nair" look like they might be the same child
-- entered twice with a typo (one letter apart, consecutive registration
-- numbers, both showed up as 'absent' for the same Gita session on
-- 2026-09-19). Pulling every available column for both so we can compare
-- parent contact info, grade, and class -- if those all match, it's a
-- duplicate row; if they genuinely differ, they're two different kids who
-- happen to have very similar names.

select *
from students
where registration_number in (19, 20);
