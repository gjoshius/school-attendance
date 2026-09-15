-- Gaurav Joshi (gjoshiusa@gmail.com) already has an active admin account,
-- but a leftover row in pending_class_assignments still ties him to 6th
-- Grade -- it never got converted into a real class_teachers row because
-- that conversion only fires automatically at signup time, and he already
-- had an account by the time this particular assignment was added. This
-- removes the stale pending row and adds the real, active assignment
-- instead, so the "Existing Classes" card stops showing him as "(pending)".
-- Safe to re-run: the delete is a no-op once done, and the insert is
-- guarded against a duplicate class_teachers row.

delete from pending_class_assignments
where class_id = 'fee7296d-70ba-404d-a6a5-802cd969c70f' -- 6th Grade
  and lower(email) = lower('gjoshiusa@gmail.com');

insert into class_teachers (class_id, teacher_id)
select 'fee7296d-70ba-404d-a6a5-802cd969c70f', 'af92c181-2e0f-45da-88b7-b17e80afa1d9'
where not exists (
  select 1 from class_teachers
  where class_id = 'fee7296d-70ba-404d-a6a5-802cd969c70f'
    and teacher_id = 'af92c181-2e0f-45da-88b7-b17e80afa1d9'
);

-- Confirm: should return one row, Gaurav Joshi / 6th Grade, and no rows
-- left in pending_class_assignments for him on this class.
select ct.class_id, c.name as class_name, p.full_name, p.email
from class_teachers ct
join classes c on c.id = ct.class_id
join profiles p on p.id = ct.teacher_id
where ct.teacher_id = 'af92c181-2e0f-45da-88b7-b17e80afa1d9'
  and ct.class_id = 'fee7296d-70ba-404d-a6a5-802cd969c70f';

select * from pending_class_assignments
where class_id = 'fee7296d-70ba-404d-a6a5-802cd969c70f'
  and lower(email) = lower('gjoshiusa@gmail.com');
