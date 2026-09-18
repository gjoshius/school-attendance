-- Lets an admin pre-decide someone's intended role at REGISTRATION time
-- (teacher_registrations), instead of only being able to decide it at
-- their first class ASSIGNMENT (pending_class_assignments.role, added in
-- 50_assistant_role.sql). Without this column, every newly registered
-- person with no assignment yet shows up twice in the admin Classes tab's
-- teacher pool -- once as Teacher, once as Assistant -- even when the
-- admin already knows which one they want, e.g. registering a batch of
-- 12th graders specifically as Assistants (see
-- 53_register_12th_grade_assistants.sql), which is exactly what surfaced
-- this as worth fixing rather than just living with.
--
-- Nullable, unconstrained by default -- null keeps today's "show both,
-- let the admin decide at assignment time" behavior for anyone this
-- doesn't apply to, so this is purely additive. src/admin.js's
-- teacherRoster now checks this as a fallback: an actual
-- pending_class_assignments.role (a real decision, once they're assigned
-- somewhere) still wins if it exists; this is only used before that.

alter table teacher_registrations
  add column if not exists role text
  check (role in ('teacher', 'assistant'));

-- Backfill this batch's already-clear intent: these nine were registered
-- specifically to become Assistants.
update teacher_registrations
set role = 'assistant'
where lower(email) in (
  lower('arya.abhinavsundar@gmail.com'),
  lower('devikaeluru45@gmail.com'),
  lower('hrushikesheluru83@gmail.com'),
  lower('SHPDESHPANDE@gmail.COM'),
  lower('KAUSHIKPALVAI@gmail.COM'),
  lower('uomswaroop@gmail.com'),
  lower('sahasramu@gmail.com'),
  lower('sudeepsenthils@gmail.com'),
  lower('Uma.narayanan1643@gmail.com')
);

-- Confirm: should return all nine (fewer only if 53 wasn't run yet, or an
-- email doesn't match what's actually in the table).
select email, full_name, role
from teacher_registrations
where role = 'assistant'
order by full_name;
