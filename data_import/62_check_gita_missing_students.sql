-- Read-only diagnostic: why did Vihaan Vennu (8th), Rudheeksha Vennu (4th),
-- Deetya Kadiyala, and Sathvik Pennam (9th) show up to today's Gita class
-- but not appear on the digital roster/chart?
--
-- How the Gita roster actually works (see src/format.js's
-- OPTIONAL_CLASS_CODE_BY_NAME doc comment and src/teacher.js's optional-class
-- section): a student keeps their grade-level class_id as their homeroom,
-- and *separately* opts into at most one Saturday class via a distinct
-- students.optional_class column ('gita' or 'bhajan'). The Gita teacher's
-- roster is built by querying students where optional_class = 'gita' --
-- NOT by grade or class_id at all. So a student can be 100% correctly
-- registered with the right grade_level and class_id and still be
-- completely invisible on the Gita roster if optional_class isn't set to
-- 'gita' for them.
--
-- Most likely explanation, based on that: these four either have
-- optional_class = null (never opted in / never recorded as opting in),
-- optional_class = 'bhajan' (opted into the other Saturday class instead,
-- possibly a data entry mix-up), or they don't have a students row at all
-- yet (e.g. new/returning registrants not yet imported -- Deetya Kadiyala
-- in particular wasn't in any of the roster cross-checks done earlier this
-- project, unlike the other three names).
--
-- Run this in the Supabase SQL editor and paste back the result.

select
  registration_number,
  full_name,
  grade_level,
  class_id,
  optional_class
from students
where
  full_name ilike '%vihaan%vennu%'
  or full_name ilike '%rudheeksha%vennu%'
  or full_name ilike '%deetya%kadiyala%'
  or full_name ilike '%sathvik%pennam%'
order by full_name;

-- If any of the four are simply MISSING from that result entirely, they
-- have no students row at all -- confirm with a broader last-name-only
-- search in case of a spelling difference:
select registration_number, full_name, grade_level, class_id, optional_class
from students
where full_name ilike '%vennu%' or full_name ilike '%kadiyala%'
order by full_name;
