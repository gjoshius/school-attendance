-- Read-only diagnostic: "Sanvitha Sree" (6th Grade, row 28 on the printed
-- Gita roster) didn't match any student when backfilling attendance for
-- 2026-09-12 (see 65_backfill_gita_attendance_20260912.sql, STEP 2).
-- Broader ILIKE search in case her database name is spelled differently or
-- includes more/less than what's on the paper sheet.

select registration_number, full_name, grade_level, class_id
from students
where full_name ilike '%sanvitha%' or full_name ilike '%sree%'
order by full_name;
