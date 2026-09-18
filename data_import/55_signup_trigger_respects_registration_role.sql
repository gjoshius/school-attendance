-- Fixes a real gap surfaced while double-checking the 12th-grade Assistant
-- batch: the signup trigger (sync_teacher_profile_on_signup, from
-- 50_assistant_role.sql) only ever reads pending_class_assignments.role to
-- decide a new profile's role -- it has no idea
-- teacher_registrations.role (added later, in
-- 54_teacher_registrations_default_role.sql) exists at all. That column
-- only ever fed the admin Classes tab's pool display (fixing the
-- show-twice UI issue) -- it never reached the trigger that actually
-- creates the profiles row.
--
-- Concretely: if one of the 12th graders registered with
-- teacher_registrations.role = 'assistant' signs up BEFORE an admin has
-- dragged them onto a class (no pending_class_assignments row exists yet
-- for them), the trigger falls through to its hardcoded 'teacher' default
-- -- silently giving them the wrong role and the wrong dashboard, with
-- nothing surfacing the mismatch anywhere.
--
-- Fix: same precedence already used in src/admin.js's teacherRoster
-- (pendingRoleByEmail || r.role) -- an actual class assignment is a real
-- decision and still wins if one exists; teacher_registrations.role is
-- now consulted as the fallback before defaulting to 'teacher'.

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

  -- No real assignment yet -- fall back to whatever role the admin set at
  -- registration time (see 54_teacher_registrations_default_role.sql).
  -- Still null if that was never set either (the common case for a
  -- general volunteer registration), in which case the coalesce below
  -- lands on 'teacher', same default as before this file.
  if invited_role is null then
    select tr.role into invited_role
    from teacher_registrations tr
    where lower(tr.email) = lower(new.email);
  end if;

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

-- Nothing to backfill: this only changes behavior for FUTURE signups.
-- Anyone who already signed up already has whatever role the old logic
-- gave them -- if any of the 12th graders already self-signed-up before
-- being assigned a class, check/fix their profiles.role directly:
--   select email, role from profiles
--   where lower(email) in (
--     lower('arya.abhinavsundar@gmail.com'), lower('devikaeluru45@gmail.com'),
--     lower('hrushikesheluru83@gmail.com'), lower('SHPDESHPANDE@GMAIL.COM'),
--     lower('KAUSHIKPALVAI@GMAI.COM'), lower('uomswaroop@gmail.com'),
--     lower('sahasramu@gmail.com'), lower('sudeepsenthils@gmail.com'),
--     lower('Uma.narayanan1643@gmail.com')
--   );
