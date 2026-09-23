-- Diagnostic follow-up: 73's STEP 1 returned zero rows -- either "Hari"
-- isn't the name on his profile, or he isn't actually linked to Gita via
-- class_teachers (or both). Two independent checks, no guessing which:

-- A) Every teacher/assistant actually assigned to the Gita class right
--    now, whoever they are -- so we can see if Hari is there under a
--    different name, or genuinely isn't linked at all.
select p.id as teacher_id, p.full_name, p.role, c.name as class_name
from class_teachers ct
join profiles p on p.id = ct.teacher_id
join classes c on c.id = ct.class_id
where c.name = 'Gita';

-- B) Every profile anywhere in the system with "hari" in the name, and
--    every class they're actually linked to (if any) -- so we can see
--    whether he exists under this name but is linked to a different
--    class (or no class at all).
select p.id as teacher_id, p.full_name, p.role, c.name as linked_class
from profiles p
left join class_teachers ct on ct.teacher_id = p.id
left join classes c on c.id = ct.class_id
where p.full_name ilike '%hari%'
order by p.full_name, c.name;
