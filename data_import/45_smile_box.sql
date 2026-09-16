-- "Smile Box": a shared wall where any teacher/admin can post a quick,
-- upbeat note about a co-teacher or student -- "what made your day" --
-- optionally tied to a specific person via src/teacher.js's search box, or
-- left general when no name fits ("should work even when name is not
-- there" was an explicit requirement). See src/teacher.js's
-- renderSmileBoxTab (the post form + shared wall every teacher sees) and
-- src/admin.js's loadSmileBoxRange (the read-only, date-filtered mirror
-- under the admin's Records tab).
--
-- Two separate nullable foreign keys (subject_student_id/
-- subject_teacher_id) rather than one polymorphic column, so a pick that
-- matches a real person stays a real, joinable reference -- subject_name
-- is always populated with whatever was typed/selected as plain text
-- (so the wall never needs a join just to render), and is the ONLY thing
-- populated when a post isn't about anyone specific, or names someone not
-- in the system at all.
--
-- Safe to re-run: `create table if not exists` leaves an existing table
-- alone, and every policy is dropped and recreated.

create table if not exists smile_box_entries (
  id uuid primary key default gen_random_uuid(),
  author_teacher_id uuid not null references profiles(id) on delete cascade,
  subject_student_id uuid references students(id) on delete set null,
  subject_teacher_id uuid references profiles(id) on delete set null,
  subject_name text,
  message text not null check (length(trim(message)) > 0),
  -- Central-time calendar date (see src/calendar.js's todayStr, set
  -- explicitly by the client on insert) -- matches how every other
  -- date-range-filtered table in this app (attendance, teacher_attendance,
  -- class_lesson_notes, volunteer_hours) stores its date, so
  -- admin.js's Records tab can filter this one the exact same way as the
  -- other four sections share one date-range filter.
  date date not null,
  -- Separate from `date` -- an exact instant, only used to order same-day
  -- posts newest-first on the wall, never for date-range filtering.
  created_at timestamptz not null default now()
);

create index if not exists smile_box_entries_date_idx on smile_box_entries (date);

alter table smile_box_entries enable row level security;

-- Any signed-in teacher or admin can post their own entry (author must be
-- the signed-in user themselves, never posted on someone else's behalf).
drop policy if exists "teachers and admins can post smile box entries" on smile_box_entries;
create policy "teachers and admins can post smile box entries"
  on smile_box_entries for insert
  with check (
    author_teacher_id = auth.uid()
    and exists (select 1 from profiles where id = auth.uid() and role in ('teacher', 'admin'))
  );

-- Shared wall: any signed-in teacher or admin can read every entry, not
-- just their own -- this is the "shared wall (all teachers can see all
-- entries)" design decision made this session, not a private inbox.
drop policy if exists "teachers and admins can read all smile box entries" on smile_box_entries;
create policy "teachers and admins can read all smile box entries"
  on smile_box_entries for select
  using (
    exists (select 1 from profiles where id = auth.uid() and role in ('teacher', 'admin'))
  );

-- Deliberately no update or delete policy -- "final once submitted" was
-- the design decision made this session (matches attendance, lesson
-- notes, and volunteer hours: nothing here is editable from the UI). With
-- RLS enabled and no policy for those two operations, Postgres denies them
-- outright for every ordinary signed-in user -- an admin who genuinely
-- needs to remove a bad entry can still do it directly in the SQL Editor.
