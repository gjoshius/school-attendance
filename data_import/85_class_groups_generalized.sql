-- Generalizes the "split a class into groups" feature from file 84's
-- narrow, Bhajan-only, hardcoded-to-exactly-two-values column into a real,
-- admin-manageable data model that works for any class -- see the "cross
-- check" discussion: an admin should be able to create any number of
-- groups, with real names, for any class, and reassign students into them
-- over time, none of which a CHECK-constrained students.attendance_group
-- text column (only ever 'group1'/'group2') could ever support.
--
-- New model:
--   class_groups: one row per group -- its own id, which class it belongs
--     to, and an admin-given name. "Group 1"/"Group 2" become ordinary
--     data an admin can rename, not values baked into a CHECK constraint.
--   students.class_group_id: replaces students.attendance_group -- a
--     student not yet assigned still has NULL here, same "ungrouped"
--     meaning as before, just via a foreign key instead of a bare string.
--
-- Migrates the 11 group1 / 9 group2 Bhajan students already classified in
-- file 84 into this new structure automatically -- nothing already
-- assigned is lost -- then drops the old column entirely, since nothing
-- should keep writing to it once this has run.
--
-- Safe to re-run: every step is guarded (create-if-not-exists /
-- drop-then-create for policies / idempotent migrate).

-- STEP 1: the groups table itself, plus RLS -- admins get full control
-- (create/rename/delete any class's groups), teachers get read-only access
-- scoped to classes they're actually assigned to (needed so
-- src/teacher.js's group picker can show real group names to whoever is
-- taking attendance).
create table if not exists class_groups (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  unique (class_id, name)
);

alter table class_groups enable row level security;

drop policy if exists "admins manage class groups" on class_groups;
create policy "admins manage class groups"
  on class_groups for all
  using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'));

drop policy if exists "teachers view groups for their own classes" on class_groups;
create policy "teachers view groups for their own classes"
  on class_groups for select
  using (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

-- STEP 2: the new column on students, replacing attendance_group.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'students' and column_name = 'class_group_id'
  ) then
    alter table students add column class_group_id uuid references class_groups(id) on delete set null;
  end if;
end $$;

-- STEP 3: an explicit, narrowly-scoped admin UPDATE policy on students --
-- added rather than assumed, same reasoning as
-- data_import/56_teachers_self_edit_attendance.sql: this repo doesn't have
-- every existing policy on `students` on file to inspect, and the new
-- admin "assign students to a group" UI needs to actually be able to write
-- this column through the app's own (RLS-governed) client rather than a
-- privileged SQL-editor session. Purely additive -- Postgres ORs every
-- matching permissive policy together, so this can't loosen or conflict
-- with whatever's already there.
drop policy if exists "admins update student group assignment" on students;
create policy "admins update student group assignment"
  on students for update
  using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'));

-- STEP 4: migrate file 84's Bhajan group1/group2 assignments into the new
-- structure. Only runs anything if attendance_group still exists (i.e.
-- this hasn't already been migrated) -- safe to re-run.
do $$
declare
  bhajan_class_id uuid;
  group1_id uuid;
  group2_id uuid;
begin
  if exists (
    select 1 from information_schema.columns
    where table_name = 'students' and column_name = 'attendance_group'
  ) then
    select id into bhajan_class_id from classes where name = 'Bhajan';

    if bhajan_class_id is not null then
      insert into class_groups (class_id, name) values (bhajan_class_id, 'Group 1')
        on conflict (class_id, name) do nothing;
      insert into class_groups (class_id, name) values (bhajan_class_id, 'Group 2')
        on conflict (class_id, name) do nothing;

      select id into group1_id from class_groups where class_id = bhajan_class_id and name = 'Group 1';
      select id into group2_id from class_groups where class_id = bhajan_class_id and name = 'Group 2';

      update students set class_group_id = group1_id
        where optional_class = 'bhajan' and attendance_group = 'group1';
      update students set class_group_id = group2_id
        where optional_class = 'bhajan' and attendance_group = 'group2';
    end if;

    -- STEP 5: drop the old narrow column + its constraint entirely --
    -- nothing should read or write it once class_group_id is in place.
    alter table students drop constraint if exists students_attendance_group_check;
    alter table students drop column if exists attendance_group;
  end if;
end $$;

-- CONFIRM 1: Bhajan's groups and how many students landed in each.
select cg.name, count(s.id) as student_count
from class_groups cg
left join students s on s.class_group_id = cg.id
where cg.class_id = (select id from classes where name = 'Bhajan')
group by cg.name
order by cg.name;

-- CONFIRM 2: still-ungrouped Bhajan students -- same 50 (minus Saanvi's
-- still-unresolved conflict) as file 84's own confirm query, just read
-- through the new column now.
select count(*) as ungrouped_count
from students
where optional_class = 'bhajan' and class_group_id is null;
