-- Trigger + function that syncs a brand-new Supabase Auth user into
-- `profiles` (from their teacher_registrations answers) and converts any
-- pending_class_assignments row for their email into a real class_teachers
-- assignment, the moment their auth.users row is created -- i.e. right
-- when they accept an invite (or, going forward, the moment an actual
-- invite creates their account; the self-service "Forgot password?" link
-- added in auth.js cannot create this row itself, since
-- resetPasswordForEmail only works for an email that already has an
-- auth.users account).
--
-- This is what admin.js, main.js, config.js, set-password.js and
-- style.css all refer to as "data_import/08c_sync_teacher_profiles.sql"
-- -- it has existed live in Supabase for a while, but was never actually
-- committed to this repo until now. Pulled directly from the live
-- database on 2026-09-15 via:
--   select pg_get_functiondef('public.sync_teacher_profile_on_signup'::regproc);
-- and the pg_trigger/pg_get_triggerdef query for the trigger itself.
--
-- Safe to re-run: CREATE OR REPLACE FUNCTION replaces the function in
-- place, and the trigger is dropped and recreated identically.

create or replace function public.sync_teacher_profile_on_signup()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- Create (or, if a profiles row somehow already exists for this id,
  -- update) their profile from the registration form answers. Existing
  -- role is preserved if already set (coalesce), so this never demotes an
  -- admin who happens to also be on the registration list.
  insert into profiles (id, email, full_name, phone, children_in_htyg, years_experience, interests, role)
  select new.id, new.email, t.full_name, t.phone, t.children_in_htyg, t.years_experience, t.interests, 'teacher'
  from teacher_registrations t
  where lower(t.email) = lower(new.email)
  on conflict (id) do update set
    email = excluded.email,
    full_name = coalesce(excluded.full_name, profiles.full_name),
    phone = excluded.phone,
    children_in_htyg = excluded.children_in_htyg,
    years_experience = excluded.years_experience,
    interests = excluded.interests,
    role = coalesce(profiles.role, 'teacher');

  -- Apply any class assignment made via drag-and-drop before this teacher
  -- signed up, then clear it so the admin Classes tab stops showing it as
  -- "pending" once it's a real assignment.
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

drop trigger if exists on_auth_user_created_sync_teacher_profile on auth.users;

create trigger on_auth_user_created_sync_teacher_profile
  after insert on auth.users
  for each row execute function sync_teacher_profile_on_signup();

-- Confirm both objects are in place
select tgname, tgrelid::regclass as table_name, tgenabled
from pg_trigger
where tgname = 'on_auth_user_created_sync_teacher_profile';
