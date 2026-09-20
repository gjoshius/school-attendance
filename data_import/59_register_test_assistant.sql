-- One-off test registration so Gaurav can reproduce the "assistant
-- self-signup gets stuck on Set Password / Confirm password" bug himself,
-- using his own email, on his own phone. Same pattern as
-- 53_register_12th_grade_assistants.sql (which documents the REAL signup
-- path for an assistant: register here, get assigned to a class from the
-- admin Classes tab if applicable, then self-signup at the login screen's
-- "New teacher? Set up your account" link -- NOT an email invite link,
-- which is a different flow this app also has but isn't what real
-- assistants actually use). role = 'assistant' set directly here (see
-- 54_teacher_registrations_default_role.sql) so the signup trigger gives
-- this test account the Assistant role even with no class assignment.
--
-- Safe to delete this registration afterward, and/or delete the resulting
-- auth user from Dashboard > Authentication > Users, once done testing.

insert into teacher_registrations (email, full_name, role)
values ('gjoshiblr@gmail.com', 'Gaurav Test Assistant', 'assistant')
on conflict (email) do update set role = 'assistant';

-- Confirm
select email, full_name, role
from teacher_registrations
where lower(email) = lower('gjoshiblr@gmail.com');
