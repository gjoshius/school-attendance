-- Read-only diagnostic: Sathvik Pennam shows up with NO registration_number
-- and no optional_class, which conflicts with data_import/41_import_students_325_326.sql
-- -- that file gave him registration_number = 325 when he was originally
-- registered. registration_number is never set anywhere in src/ (grepped --
-- zero matches), including the admin "Add Student" form, which only ever
-- writes full_name/class_id/optional_class. So the likely explanation is a
-- SECOND, duplicate row for him -- created later through Add Student
-- (which can't set a registration_number, and defaults optional_class to
-- blank unless explicitly picked) -- sitting alongside his real, original
-- row (#325).
--
-- Run this in the Supabase SQL editor and paste back the result -- if two
-- rows come back, that confirms the duplicate and tells us which one is
-- the real one (the one with registration_number = 325) versus the stray
-- one to clean up.

select id, registration_number, full_name, grade_level, class_id, optional_class
from students
where full_name ilike '%sathvik%pennam%'
order by id;
