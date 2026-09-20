-- Re-fixes Charani Nalluri's grade, which is apparently still showing as
-- 7th Grade despite 40_fix_charani_nalluri_grade.sql already existing in
-- this repo to fix exactly that. Two likely reasons that one didn't take:
--   1. It was written but never actually run against the live database
--      (this repo can't tell -- only Supabase's SQL editor knows).
--   2. Its WHERE clause (registration_number = 217, exact case-insensitive
--      full_name match) matched zero rows -- e.g. the real
--      registration_number is different, or the stored name has different
--      spacing/spelling than expected.
--
-- This version is more defensive on both fronts: it matches by a loose
-- ILIKE pattern on the name instead of a hardcoded registration_number (so
-- it doesn't matter if 217 was ever right), and it updates class_id
-- alongside grade_level (40 only touched grade_level) -- the admin
-- Students tab shows BOTH (src/admin.js's renderStudentList: grade_level
-- as the main label, plus the linked class's name in parentheses if it
-- ever differs from grade_level) so leaving class_id pointed at the old
-- 7th Grade class could keep showing something 7th-Grade-related even
-- after grade_level itself says 8th.
--
-- STEP 1 -- run this SELECT first and look at what comes back before
-- running the UPDATE below. It's read-only and safe to run any time.
-- If more than one row comes back, or the name looks different from what
-- you expect, stop and paste the result back rather than running the
-- update -- it means there's something (a duplicate, a typo in the stored
-- name) worth sorting out first rather than blindly overwriting.

select registration_number, full_name, grade_level, class_id
from students
where full_name ilike '%charani%nalluri%' or full_name ilike '%nalluri%charani%';

-- STEP 2 -- only run this once STEP 1's result looks like exactly one row,
-- for the right kid. Safe to re-run (it's just an update, not an insert).
-- Matches the same loose pattern as STEP 1 rather than a specific
-- registration_number, so it can't silently miss again over a number
-- mismatch.

update students
set
  grade_level = '8th Grade',
  class_id = (select id from classes where name = '8th Grade')
where full_name ilike '%charani%nalluri%' or full_name ilike '%nalluri%charani%';

-- STEP 3 -- confirm: should show exactly one row, grade_level = '8th
-- Grade', and class_id equal to the 8th Grade class's own id (compare
-- against `select id from classes where name = '8th Grade'` if you want to
-- double check they match).

select registration_number, full_name, grade_level, class_id
from students
where full_name ilike '%charani%nalluri%' or full_name ilike '%nalluri%charani%';
