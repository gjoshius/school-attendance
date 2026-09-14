-- Promotes Vidya (vidyams@gmail.com) from 'teacher' to 'admin' in profiles.
-- This is the only thing that actually matters for admin access -- every
-- RLS policy in this app (class_sessions, attendance, teacher_attendance,
-- class_lesson_notes, teacher_registrations, etc.) checks
-- `exists (select 1 from profiles where id = auth.uid() and role = 'admin')`,
-- so flipping this one column is a complete, real admin grant, not a
-- partial/cosmetic one.
--
-- Safe to re-run -- if she's already admin this is a no-op.
--
-- Requirement: Vidya must already have signed up and logged in at least
-- once (so her auth.users + profiles row exists -- see
-- data_import/29_auto_sync_teacher_profile_trigger.sql). If the UPDATE
-- below reports "0 rows affected", that's why -- have her sign up first,
-- then run this.

update profiles
set role = 'admin'
where id = (select id from auth.users where lower(email) = lower('vidyams@gmail.com'));

-- Confirms it worked -- should show role = 'admin'.
select id, email, full_name, role
from profiles
where lower(email) = lower('vidyams@gmail.com');
