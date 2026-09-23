-- Read-only check: confirms whether 64_assign_gita_optional_class.sql was
-- actually run. Unlike 65/67/69/70 (all confirmed executed via pasted
-- results), 64 never had its result pasted back, so it's unclear whether
-- it was applied. If optional_class isn't 'gita' for all four below,
-- that's the one thing still worth running from this whole session.

select registration_number, full_name, grade_level, optional_class
from students
where registration_number in (21, 165, 166, 325, 97)
order by registration_number;
