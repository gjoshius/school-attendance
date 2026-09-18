-- Adds a new "assistant" role for minors and new volunteers: same
-- attendance-taking + Smile Box access as a full teacher, but scoped
-- strictly to the one class they're assigned to -- no program-wide
-- attendance visibility (the "teachers view all attendance for volunteer
-- eligibility" policy stays role = 'teacher' only, untouched), and no
-- Log Hours tab (src/teacher.js gates that client-side by role).
--
-- Confirmed live state before this change:
--   profiles_role_check: role = ANY (ARRAY['admin', 'teacher'])
--   pending_class_assignments: (email, class_id, created_at) -- no role column
--   teacher_registrations: no role column either
--   class_lesson_notes / teacher_attendance: already scoped entirely via
--     class_teachers membership, not role-gated -- so an assistant with a
--     class_teachers row already gets these working with zero changes.
--   attendance: only two SELECT policies exist today (admin ALL, and
--     "teachers view all attendance for volunteer eligibility" which is
--     role = 'teacher' only) -- neither lets an assistant read even their
--     own class's attendance, so a new scoped SELECT policy is added below.
--   smile_box_entries: both its policies check role in ('teacher', 'admin')
--     -- 'assistant' is added to that list.
--   class_teachers: only "teacher_id = auth.uid()" (own row) exists for a
--     non-admin SELECT -- meaning a teacher's own co-teacher names embed
--     (classes(*, class_teachers(teacher_id, profiles(full_name)))) was
--     silently returning only their own row, not their co-teachers', since
--     RLS filters each embedded row independently. Fixed below for
--     everyone, not just assistants -- this was already broken for regular
--     teachers, just never noticed since nothing errors, it just returns
--     fewer rows.

-- 1) Allow 'assistant' as a role value.
alter table profiles drop constraint profiles_role_check;
alter table profiles add constraint profiles_role_check
  check (role = any (array['admin'::text, 'teacher'::text, 'assistant'::text]));

-- 2) Let an admin specify the role when inviting someone not yet signed up.
-- Defaults to 'teacher' so every existing pending invite keeps behaving
-- exactly as it does today.
alter table pending_class_assignments
  add column if not exists role text not null default 'teacher'
  check (role in ('teacher', 'assistant'));

-- 3) Signup trigger: read the invited role from pending_class_assignments
-- instead of hardcoding 'teacher'. If someone has more than one pending
-- assignment with different roles (shouldn't normally happen), 'teacher'
-- wins over 'assistant' rather than silently under-privileging them. Falls
-- back to 'teacher' if there's no pending assignment at all (e.g. someone
-- who filled out teacher_registrations but hasn't been assigned a class
-- yet), matching today's behavior exactly.
create or replace function public.sync_teacher_profile_on_signup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  invited_role text;
begin
  select pca.role into invited_role
  from pending_class_assignments pca
  where lower(pca.email) = lower(new.email)
  order by (pca.role = 'teacher') desc
  limit 1;

  invited_role := coalesce(invited_role, 'teacher');

  insert into profiles (id, email, full_name, phone, children_in_htyg, years_experience, interests, role)
  select new.id, new.email, t.full_name, t.phone, t.children_in_htyg, t.years_experience, t.interests, invited_role
  from teacher_registrations t
  where lower(t.email) = lower(new.email)
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name),
    phone = excluded.phone,
    children_in_htyg = excluded.children_in_htyg,
    years_experience = excluded.years_experience,
    interests = excluded.interests,
    role = coalesce(profiles.role, invited_role);

  insert into class_teachers (class_id, teacher_id)
  select pca.class_id, new.id
  from pending_class_assignments pca
  where lower(pca.email) = lower(new.email)
  on conflict (class_id, teacher_id) do nothing;

  delete from pending_class_assignments
  where lower(email) = lower(new.email);

  return new;
end;
$function$;

-- 4) attendance: a scoped SELECT policy an assistant can actually use (the
-- existing broad one is deliberately role = 'teacher' only, so it correctly
-- continues to NOT apply to assistants). Harmless/redundant for full
-- teachers, who already have broader access via the existing policy.
drop policy if exists "teachers view their class's attendance" on attendance;
create policy "teachers view their class's attendance"
  on attendance for select
  using (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

-- 5) smile_box_entries: let assistants post and read the wall too.
drop policy if exists "teachers and admins can post smile box entries" on smile_box_entries;
create policy "teachers and admins can post smile box entries"
  on smile_box_entries for insert
  with check (
    author_teacher_id = (select auth.uid())
    and exists (select 1 from profiles where id = (select auth.uid()) and role in ('teacher', 'assistant', 'admin'))
  );

drop policy if exists "teachers and admins can read all smile box entries" on smile_box_entries;
create policy "teachers and admins can read all smile box entries"
  on smile_box_entries for select
  using (
    exists (select 1 from profiles where id = (select auth.uid()) and role in ('teacher', 'assistant', 'admin'))
  );

-- 6) class_teachers: let a teacher/assistant see their co-teachers' rows
-- for classes they share, not just their own row. Non-recursive: the inner
-- subquery's own row is already granted by the existing "teachers can view
-- their own class links" policy, so this doesn't call itself in a loop --
-- it just extends visibility to sibling rows sharing the same class_id.
drop policy if exists "teachers can view co-teachers on shared classes" on class_teachers;
create policy "teachers can view co-teachers on shared classes"
  on class_teachers for select
  using (
    class_id in (
      select ct.class_id
      from class_teachers ct
      where ct.teacher_id = (select auth.uid())
    )
  );

-- Confirm everything landed.
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'profiles'::regclass and contype = 'c';

select column_name, data_type, column_default
from information_schema.columns
where table_name = 'pending_class_assignments' and column_name = 'role';

select tablename, policyname, cmd
from pg_policies
where tablename in ('attendance', 'smile_box_entries', 'class_teachers')
order by tablename, cmd, policyname;
