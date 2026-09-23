-- Before backfilling Bhajan attendance for 2026-09-12 from the two group
-- lists (first names only), pulling the full current Bhajan roster so
-- each first name can be matched to an exact student -- same caution as
-- the Gita backfill earlier this session, which caught a dropped surname
-- (Sanvitha Sree Somavarapu) and a near-duplicate-looking pair
-- (Nandhakishore/Navhakishore) that first-name-only matching would have
-- gotten wrong. With only first names to go on here, matching by eye
-- against the real roster (rather than a same-session ILIKE match at
-- insert time) is the safer way to resolve any ambiguity or near-miss
-- before anything gets written.
--
-- Also useful on its own: whoever's on this roster but NOT in either
-- group list is who'll need to be marked absent for 2026-09-12, same
-- "every roster student gets a row" convention as every other backfill
-- this session (see e.g. 65_backfill_gita_attendance_20260912.sql).

select id, registration_number, full_name, grade_level
from students
where optional_class = 'bhajan'
order by full_name;
