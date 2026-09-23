-- Before designing the two-groups-with-independent-submission feature:
-- need to know who's actually assigned to teach Bhajan right now. If it's
-- just Hari, "each teacher takes their own group" means someone else
-- needs to be added as a second co-teacher on this class first (see
-- data_import/06_multi_teacher_classes.sql), before per-group submission
-- can mean anything.

select p.id as teacher_id, p.full_name, p.role
from class_teachers ct
join profiles p on p.id = ct.teacher_id
join classes c on c.id = ct.class_id
where c.name = 'Bhajan';
