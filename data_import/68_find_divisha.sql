-- Read-only diagnostic: find "Divisha" (5th Grade), the one confirmed
-- Gita walk-in from the paper sign-in sheets whose full database record we
-- still haven't nailed down (see data_import/62_check_gita_missing_students.sql
-- and the consolidated spreadsheet -- she's the only one of the four
-- walk-ins not yet added to 64_assign_gita_optional_class.sql or the
-- attendance backfill).
--
-- Broader match on "divis" rather than the full "divisha" in case her
-- database name has a surname attached (exactly what happened with
-- Sanvitha Sree Somavarapu -- see 66_check_sanvitha_sree.sql) or the
-- handwriting was slightly misread.

select registration_number, full_name, grade_level, class_id, optional_class
from students
where full_name ilike '%divis%'
order by full_name;
