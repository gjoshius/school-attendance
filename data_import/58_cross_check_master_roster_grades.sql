-- Read-only diagnostic: cross-checks the 7 students from a master-roster
-- screenshot Gaurav shared against what's actually stored in the live
-- database, the same way 57_fix_charani_nalluri_grade_for_real.sql's
-- STEP 1 checked Charani specifically. Nothing here writes anything --
-- run it in the Supabase SQL editor and paste the result back so it can
-- be compared against the roster:
--
--   Indira Kothapalli   -- 1st Grade
--   Anshika Chinthaluri -- 1st Grade
--   Kireeti Sarvigari   -- 4th Grade
--   Priyanka Mulukutla  -- 8th Grade
--   Charani Nalluri     -- 8th Grade (already being fixed separately --
--                           see 57_fix_charani_nalluri_grade_for_real.sql)
--   Nivedh Banda        -- 9th Grade
--   Sathvik Pennam      -- 9th Grade
--
-- Matched by a loose ILIKE on each name (not exact equality) so a
-- different spacing/capitalization in the stored name still turns up
-- here rather than silently not matching.

select registration_number, full_name, grade_level, class_id
from students
where
  full_name ilike '%indira%kothapalli%'
  or full_name ilike '%anshika%chinthaluri%'
  or full_name ilike '%kireeti%sarvigari%'
  or full_name ilike '%priyanka%mulukutla%'
  or full_name ilike '%charani%nalluri%'
  or full_name ilike '%nivedh%banda%'
  or full_name ilike '%sathvik%pennam%'
order by full_name;
