-- Adds a "recognition" feature: teachers define their own point categories
-- per class (e.g. "Most Helpful", "Great Effort") and award points to kids
-- over time. Points accumulate into a per-category and an overall
-- leaderboard -- see the app's own design note: "teacher can define their
-- own category and give points to kids .. which could become a leaderboard
-- for kids and later kids can be awarded on basis of these". This is
-- deliberately an append-only log of point-award events (not just a running
-- total column) so that later "award a kid based on their points" logic has
-- the full history to work from, not just a final number.
--
-- Design decisions (per the app owner):
--   * Categories are per-class, same pattern as class_groups (file 85) --
--     any teacher assigned to a class shares that class's categories.
--   * A teacher can edit/delete their own point awards (and their own
--     categories) to fix mistakes -- not a permanent, unchangeable log.
--   * Admins get read-only visibility across all classes (mirrors how
--     Smile Box posts show up read-only under Admin > Records).
--
-- Safe to re-run: create-if-not-exists / drop-then-create for policies.

-- STEP 1: recognition_categories -- one row per named category, scoped to
-- a class. created_by records which teacher defined it (used to decide who
-- may rename/delete it -- see STEP 3).
create table if not exists recognition_categories (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  name text not null,
  created_by uuid not null references profiles(id),
  created_at timestamptz not null default now(),
  unique (class_id, name)
);

alter table recognition_categories enable row level security;

drop policy if exists "admins manage recognition categories" on recognition_categories;
create policy "admins manage recognition categories"
  on recognition_categories for all
  using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'));

drop policy if exists "teachers view categories for their own classes" on recognition_categories;
create policy "teachers view categories for their own classes"
  on recognition_categories for select
  using (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "teachers create categories for their own classes" on recognition_categories;
create policy "teachers create categories for their own classes"
  on recognition_categories for insert
  with check (
    created_by = (select auth.uid())
    and class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

-- Rename/delete restricted to whichever teacher created the category (plus
-- admins, via the ALL policy above) -- co-teachers can still see and award
-- points against it (STEP 2), just not rename or remove someone else's
-- category out from under them.
drop policy if exists "teachers manage own categories" on recognition_categories;
create policy "teachers manage own categories"
  on recognition_categories for update
  using (created_by = (select auth.uid()))
  with check (created_by = (select auth.uid()));

drop policy if exists "teachers delete own categories" on recognition_categories;
create policy "teachers delete own categories"
  on recognition_categories for delete
  using (created_by = (select auth.uid()));

-- STEP 2: recognition_points -- one row per point-award event. class_id is
-- denormalized here (rather than only reachable via category_id) so RLS and
-- the leaderboard queries don't need a join, same reasoning as attendance
-- storing class_id directly instead of only via students.
create table if not exists recognition_points (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  category_id uuid not null references recognition_categories(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  points integer not null check (points > 0),
  teacher_id uuid not null references profiles(id),
  note text,
  awarded_at timestamptz not null default now()
);

create index if not exists recognition_points_class_id_idx on recognition_points (class_id);
create index if not exists recognition_points_category_id_idx on recognition_points (category_id);
create index if not exists recognition_points_student_id_idx on recognition_points (student_id);

alter table recognition_points enable row level security;

drop policy if exists "admins manage recognition points" on recognition_points;
create policy "admins manage recognition points"
  on recognition_points for all
  using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'));

drop policy if exists "teachers view points for their own classes" on recognition_points;
create policy "teachers view points for their own classes"
  on recognition_points for select
  using (
    class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

drop policy if exists "teachers award points for their own classes" on recognition_points;
create policy "teachers award points for their own classes"
  on recognition_points for insert
  with check (
    teacher_id = (select auth.uid())
    and class_id in (
      select class_teachers.class_id
      from class_teachers
      where class_teachers.teacher_id = (select auth.uid())
    )
  );

-- Edit/delete restricted to the teacher who gave the award (plus admins) --
-- lets a teacher fix a typo'd amount or an accidental award without
-- touching anyone else's.
drop policy if exists "teachers manage own point awards" on recognition_points;
create policy "teachers manage own point awards"
  on recognition_points for update
  using (teacher_id = (select auth.uid()))
  with check (teacher_id = (select auth.uid()));

drop policy if exists "teachers delete own point awards" on recognition_points;
create policy "teachers delete own point awards"
  on recognition_points for delete
  using (teacher_id = (select auth.uid()));

-- CONFIRM 1: tables exist and are empty (expected right after first run).
select 'recognition_categories' as table_name, count(*) from recognition_categories
union all
select 'recognition_points', count(*) from recognition_points;
