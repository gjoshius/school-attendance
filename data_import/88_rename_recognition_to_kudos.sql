-- Renames the "Recognition" feature to "Kudos" -- app owner decided
-- "Recognition" wasn't the right name for it. This migration only renames
-- database objects; nothing about the feature's behavior, RLS logic, or
-- data changes at all. The app code (teacher.js/admin.js/config.js/
-- style.css) has already been updated to read/write the kudos_* names
-- below, so this must run before that updated code is deployed.
--
-- data_import/86_recognition_categories_and_points.sql and 87_recognition_
-- points_cap_at_10.sql keep their original filenames and content as
-- historical record (same "supersede, don't rewrite" precedent as file 85
-- superseding file 84) -- this file is what actually renames the live
-- tables they created.
--
-- Renamed: the two tables, their primary keys, the unique(class_id, name)
-- constraint, the points check constraint (see file 87), the three indexes
-- on recognition_points, and the two admin policies whose names actually
-- contained the word "recognition". Every other policy's name never
-- mentioned "recognition" in the first place (e.g. "teachers view points
-- for their own classes") -- those are left exactly as-is, nothing to
-- rename. Auto-generated foreign-key constraint names (e.g.
-- recognition_points_category_id_fkey) are also left as-is -- cosmetic
-- only, never surfaced anywhere in the app or to any user.
--
-- Safe to re-run: every step is guarded so a second run is a no-op.

-- STEP 1: the tables themselves.
alter table if exists recognition_categories rename to kudos_categories;
alter table if exists recognition_points rename to kudos_points;

-- STEP 2: primary keys (default Postgres naming: <original_table>_pkey --
-- confirmed against a local test database seeded via files 86+87 before
-- writing this migration).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'recognition_categories_pkey' and conrelid = 'kudos_categories'::regclass
  ) then
    alter table kudos_categories rename constraint recognition_categories_pkey to kudos_categories_pkey;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'recognition_points_pkey' and conrelid = 'kudos_points'::regclass
  ) then
    alter table kudos_points rename constraint recognition_points_pkey to kudos_points_pkey;
  end if;
end $$;

-- STEP 3: the points check constraint (see file 87).
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'recognition_points_points_check' and conrelid = 'kudos_points'::regclass
  ) then
    alter table kudos_points rename constraint recognition_points_points_check to kudos_points_points_check;
  end if;
end $$;

-- STEP 4: the unique(class_id, name) constraint on categories. Renaming a
-- unique constraint directly isn't supported the same simple way as a
-- check constraint in every Postgres version, so this drops the old-named
-- one and adds an identical new-named one -- same idiom file 87 already
-- used for the check constraint's own drop-then-add. Guarded on the
-- new-named constraint not already existing, so a second run is a no-op
-- rather than an error.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'kudos_categories_class_id_name_key' and conrelid = 'kudos_categories'::regclass
  ) then
    alter table kudos_categories drop constraint if exists recognition_categories_class_id_name_key;
    alter table kudos_categories add constraint kudos_categories_class_id_name_key unique (class_id, name);
  end if;
end $$;

-- STEP 5: indexes on kudos_points (see file 86). ALTER INDEX ... IF EXISTS
-- is naturally idempotent -- the old name simply won't exist on a re-run.
alter index if exists recognition_points_class_id_idx rename to kudos_points_class_id_idx;
alter index if exists recognition_points_category_id_idx rename to kudos_points_category_id_idx;
alter index if exists recognition_points_student_id_idx rename to kudos_points_student_id_idx;

-- STEP 6: the two admin policies whose names said "recognition" -- same
-- drop-if-exists/create idiom as every other migration in this repo, with
-- USING/WITH CHECK logic byte-for-byte identical to file 86's, only the
-- policy's own name and table changes.
drop policy if exists "admins manage recognition categories" on kudos_categories;
create policy "admins manage kudos categories"
  on kudos_categories for all
  using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'));

drop policy if exists "admins manage recognition points" on kudos_points;
create policy "admins manage kudos points"
  on kudos_points for all
  using (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'))
  with check (exists (select 1 from profiles where id = (select auth.uid()) and role = 'admin'));

-- CONFIRM: both tables renamed, row counts unchanged (no data touched).
select 'kudos_categories' as table_name, count(*) from kudos_categories
union all
select 'kudos_points', count(*) from kudos_points;
