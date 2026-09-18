-- Fixes profiles' only policy, "Authenticated read" (using (true)): any
-- signed-in user -- including one with no profiles row of their own, e.g.
-- a self-signup nobody ever authorized -- could read every teacher, admin,
-- and now assistant's full_name, phone, children_in_htyg,
-- years_experience, and interests. Same open-read pattern already fixed on
-- attendance twice this session.
--
-- Confirmed live state before this change: profiles has exactly one
-- policy total (this one) -- no admin-specific policy exists, and nothing
-- in the app writes to profiles client-side (only the SECURITY DEFINER
-- signup trigger does, which bypasses RLS entirely), so this is the only
-- policy that needs fixing.
--
-- Replacement: a signed-in user can always read their own row (needed for
-- src/main.js's getUserRole(), which runs immediately after every login to
-- decide which dashboard to show), and any legitimate staff member
-- (admin/teacher/assistant) can read every other staff member's profile --
-- unchanged in practice for real teachers/admins/assistants, since that's
-- the same visibility they already relied on for co-teacher names and
-- Smile Box's people search. What's actually closed off is exactly the
-- attendance fix's equivalent: an authenticated account that isn't any of
-- those three roles (no profiles row, or a self-signup nobody approved)
-- no longer sees anyone else's data.

drop policy if exists "Authenticated read" on profiles;

create policy "staff can view their own and each other's profile"
  on profiles for select
  using (
    id = (select auth.uid())
    or exists (
      select 1 from profiles p2
      where p2.id = (select auth.uid())
        and p2.role in ('admin', 'teacher', 'assistant')
    )
  );

-- Confirm: "Authenticated read" should no longer appear.
select policyname, cmd, qual, with_check
from pg_policies
where tablename = 'profiles';
