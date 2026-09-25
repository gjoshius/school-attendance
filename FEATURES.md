# HTYG School Attendance — Feature Reference

A snapshot of every functionality currently built into the app, based on a full read of `src/` and `data_import/` as of 2026-09-25. This is a living inventory, not a change log — update it when a feature is added or changed materially.

The app is a installable PWA (offline-capable, add-to-home-screen) built with Vite + Supabase, used to run daily class attendance for HTYG (Hindu Temple Youth Group) and manage everything around it: classes, teachers, volunteer hours, and a few morale/recognition features.

## Roles & access

Three roles, all stored in `profiles.role`:

- **Admin** — full access to every tab, every class.
- **Teacher** — full dashboard, but scoped to their own assigned class(es).
- **Assistant** — same dashboard as a Teacher, minus the Volunteer/Log Hours tab and program-wide attendance access.

Someone who is both an Admin and personally teaches a class gets an Admin / My Class switcher to flip between the two dashboards without a second account (`renderDualRoleShell`, `main.js`).

A class can have more than one teacher assigned (`class_teachers` join table) — any of them can take attendance for it, and a teacher can be linked to more than one class at once (a class switcher appears on their dashboard when they are).

## At a glance: Admin view vs. Teacher/Assistant view

| Area | Admin sees | Teacher / Assistant sees |
| --- | --- | --- |
| Attendance | Today tab: live status board across every class, real-time submission + presence dots | Take Attendance tab: mark today's roster for their own assigned class(es) only |
| Past attendance | Records tab: full history, any class, any date range, plus Backfill Attendance | History tab: their own class's past dates only, no editing |
| Lesson notes | Read-only, on the Records tab, for any class/date | Write on submission day; edit any time after from their own class's view |
| Classes & teachers | Classes tab: create classes, assign/reassign teachers, decide Teacher vs Assistant | No visibility into other classes' assignments |
| Class Groups | Class Groups tab: create/rename/delete groups, assign students into them | Group picker appears automatically on Take Attendance/History when their class has groups — no management controls |
| Students | Students tab: full roster, filterable by grade | No dedicated tab — only see their own class's roster inside their own tabs |
| Kudos | Kudos tab: read-only mirror — leaderboard + full award history, any class | Kudos tab: award 1–10 points, manage categories, edit/delete their own awards, for their own class only |
| Insights | No dedicated tab (Insights is teacher/assistant-only) | Insights tab: most-present/most-absent leaderboards + per-category Kudos breakdown, own class only |
| Smile Box | Read-only mirror under Records, filterable by date range | Smile Box tab: post and read the full shared wall |
| Calendar | Calendar tab: manage the schedule — add/edit dates, holidays, events | Calendar tab: read-only schedule, plus their own Available/Unavailable toggle per date |
| Teacher Availability | Teacher Availability tab: read-only board of every teacher's status, any class, one selected date | Sets their own availability on their Calendar tab; can't see others' |
| Volunteer Hours | Volunteer Hours tab: review, accept, edit, or delete submissions from any team | Log Hours tab: submit their own team's hours (hidden for assistants) |
| Activity / audit log | Activity tab: every admin/teacher action, any actor, filterable | No access |
| Roles | Assign Teacher/Assistant via Classes tab; promote to Admin only via direct SQL | No role-management access |

## Onboarding

- **Registration** (`teacher_registrations`) — a person's email, name, and (optionally) their intended role are recorded before they ever sign in. No in-app form for this yet; it's a direct database insert.
- **Self-signup** ("New teacher? Set up your account" on the sign-in screen) — creates their `auth.users` account; a database trigger (`sync_teacher_profile_on_signup`) then automatically creates their `profiles` row and converts any pending class assignment into a real one.
- **Class assignment locks in role** — dragging a registered person's chip onto a class from the admin Classes tab (or a class's own "+ Add teacher" dropdown) decides Teacher vs Assistant, before or independent of self-signup.
- **Admin promotion** — no in-app path; a direct `profiles.role = 'admin'` update after the person already has a working account.
- **Password recovery** — "Forgot password?" lands on the "Set Your Password" form (`set-password.js`), detected via Supabase's recovery flow plus a `sessionStorage` flag to survive mobile in-app-browser redirects. The same form is also written to handle an admin-sent invite link the same way — but there's currently no tool that actually sends one (`data_import/invite_teachers.mjs` is referenced in code comments as that tool, but doesn't exist in the repo; see Known gaps).
- **Password rules** — shared validation (`password-rules.js`) and a show/hide eye-icon toggle (`password-toggle.js`) used everywhere a password is entered.
- **Direct password set (`data_import/set_user_password.mjs`)** — a one-off CLI script, run from a terminal (not through the app), that sets an existing user's password directly via the Supabase Admin API using the project's `service_role` key — for when the "Forgot password?" email isn't reaching someone. Bypasses email entirely; whoever runs it must hand the new password to that person directly (call/text/in person) and never commit the `service_role` key anywhere.

*(Full step-by-step for this section lives in the "New Teacher Registration & Role Assignment" doc.)*

## Admin dashboard

Tabs, in the order they appear:

1. **Today** — live status board, one card per class, showing whether attendance was submitted today; updates in real time as teachers submit (Supabase Realtime on `attendance` INSERT/UPDATE). A second, independent Realtime channel (Presence) shows a live dot on any class whose teacher currently has the attendance screen open. Also surfaces a "Pending Volunteer Hours" card so an admin sees anything awaiting review without visiting that tab.
2. **Classes** — create classes; assign teacher(s) to each one via drag-and-drop from a combined roster pool (active + pending-registration people) or a per-class "+ Add teacher" dropdown. This is also where Teacher vs Assistant gets decided for a newly registered person (see Onboarding above).
3. **Students** — list every student with class/grade, filterable by grade; add-student form exists but is currently hidden (`SHOW_ADD_STUDENT_FORM`).
4. **Records** — three sub-sections under one shared date-range filter:
   - Student Attendance (per-class summaries + a detailed log)
   - Teacher Attendance (who actually showed up to teach) + that day's lesson notes
   - Volunteer Hour Records (finalized/accepted hours only — pending ones live on the Volunteer Hours tab)
   - Also hosts "+ Backfill Attendance", for entering attendance on a past date that has none or incomplete data.
   - Also mirrors the Smile Box wall read-only, filtered by date range.
5. **Volunteer Hours** — review/accept/edit/delete hours submitted by a team's teacher via their Log Hours tab (eligible to Madhyamshishyas/Yuvashishyas students only). No free-form "add a new entry" here — entries always originate from a teacher submission.
6. **Class Groups** — split any class into named sub-groups (e.g. splitting Bhajan or a large grade into smaller groups) and assign students into them. A class with none defined is unaffected everywhere else. Once a class has groups, its teacher(s) see a group picker instead of one shared roster on Take Attendance, and each group's submission is tracked independently.
7. **Kudos** — read-only admin mirror of the teacher-given points/recognition system: pick a class, see the leaderboard by category (or overall) and the full award history with teacher + student names. No write actions here — awarding happens on the teacher side.
8. **Calendar** — manage the class_sessions schedule: which Saturdays are regular classes, holidays, or special events, plus ad-hoc extra dates.
9. **Teacher Availability** — card board for a single selected date, one card per class, showing each assigned teacher's self-reported availability (set by the teacher on their own Calendar tab). Read-only here; a card with any teacher marked Unavailable gets a red border to stand out.
10. **Activity** — read-only, filterable audit log of every data-changing action any admin or teacher has taken, newest first, defaulting to the last 7 days. No edit/delete on this tab by design.

## Teacher / Assistant dashboard

Tabs shown depend on what the person is assigned to (a volunteer-team-only person skips the class-specific tabs entirely; Log Hours is hidden for assistants):

1. **Take Attendance** — mark each student present/absent for today, plus the teacher's own attendance; supports multi-teacher classes and a lesson-note field. Co-teachers who marked themselves Unavailable for today default to that status instead of Present unless already recorded otherwise. If the class has groups, students are worked through group-by-group. A teacher can also self-request an edit of an already-submitted day.
2. **Volunteer Hours ("Log Hours")** — submit hours for eligible students on the teacher's volunteer team; shows overall and last-30-day attendance percentage per student to help spot who's been showing up. Hidden for assistants and for anyone with no volunteer team.
3. **History** — every past attendance date for this class, newest first, collapsed to a quick present/absent count until expanded; splits by class group when the class has any.
4. **Insights** — all-time "most present" / "most absent" leaderboards for the current roster (cumulative counts + percentage), plus a per-Kudos-category breakdown. A student never once marked either way is excluded from the rankings and called out separately, rather than silently missing.
5. **Kudos** (formerly "Recognition") — teacher-defined recognition categories with 1–10 point awards to students, an optional note, a recent-awards log editable/deletable by the awarding teacher only, and a "Manage Categories" panel (add/rename/delete, own-only for rename/delete). Feeds the Insights per-category leaderboard and the admin's read-only Kudos mirror.
6. **Smile Box** — post a short, upbeat note about a co-teacher or student ("what made your day"); shared wall, everyone sees every post, nothing can be edited or deleted from the UI once posted. Optional search-and-tag of any person in the program, not just the poster's own class.
7. **Calendar** — same schedule the admin manages, read-only, plus a per-date Available/Unavailable toggle a teacher sets for themselves (feeds the admin Teacher Availability tab and the Attendance form's co-teacher default).

## Cross-cutting features

- **Multi-teacher / multi-class support** — a class can have more than one teacher; a teacher can have more than one class (switcher on their dashboard).
- **Optional Saturday classes (Gita, Bhajan)** — rostered by `students.optional_class` rather than `students.class_id`, tracked and reported the same as grade homerooms everywhere else.
- **Lesson notes** — a short note a teacher leaves on the day's attendance about what was covered; viewable/editable independently of the locked attendance record, and reviewable by admins on the Records tab for any past date.
- **Off-canvas drawer navigation** (`nav.js`) — shared tab-picker UI for both dashboards, replacing an on-screen tab row that had outgrown every layout as more tabs were added.
- **Audit trail** (`audit.js`, `data_import/24_audit_log.sql`) — every data-changing action is logged (who, what, when); browsable on the admin Activity tab; never editable or deletable.
- **Title Case display formatting** (`format.js`) — names are normalized for display (e.g. "SAKTHIDARAN ADALARASU" → "Sakthidaran Adalarasu") wherever a student or teacher name appears, regardless of how it was typed at signup or registration.
- **Installable PWA** — offline-capable, auto-updating service worker, home-screen install with the temple's branding (`vite.config.js`).

## Supabase features used, and where

- **Auth (email/password only — no social/OAuth providers)**
  - Sign in: `supabase.auth.signInWithPassword` (`src/auth.js`)
  - Self-signup: `supabase.auth.signUp` (`src/auth.js`) — email confirmations are off for this project, so a successful signup signs the person in immediately, no confirmation email to wait on.
  - Password reset request: `supabase.auth.resetPasswordForEmail` (`src/auth.js`) — lands back on `src/set-password.js` via a `PASSWORD_RECOVERY` event.
  - Set/update password: `supabase.auth.updateUser` (`src/set-password.js`)
  - Session watching, routing, sign out: `supabase.auth.onAuthStateChange`, `supabase.auth.signOut` (`src/main.js`)
  - Admin API (`auth.admin.listUsers`, `auth.admin.updateUserById`), using the `service_role` key — only in the standalone `data_import/set_user_password.mjs` CLI script, run by hand from a terminal. Never called from the app itself, and the key never appears in `src/`.

- **Database (Postgres) + Row Level Security** — every table's access control is enforced by RLS policies inside the database, not by app code; the client (`src/supabase.js`) only ever holds the "publishable" (anon) key, which by itself grants nothing beyond what RLS allows. Every `data_import/*.sql` file is a direct SQL change (tables, columns, constraints, RLS policies) — there's no ORM or schema-migration tool in front of it.

- **Postgres functions & triggers** — the one piece of real server-side logic in the whole app: `sync_teacher_profile_on_signup()`, a `security definer` function running as an `after insert on auth.users` trigger (`data_import/08c_sync_teacher_profiles.sql`, later updated by `50_assistant_role.sql` and `55_signup_trigger_respects_registration_role.sql`). It creates the new signup's `profiles` row and converts any pending class assignment, entirely inside the database, with no app code involved at the moment of signup.

- **Realtime**
  - Postgres Changes: the admin Today tab subscribes to INSERT/UPDATE on `attendance` so the status board updates live as teachers submit (`src/admin.js`, `window._attendanceChannel`).
  - Presence: a teacher's device broadcasts that they currently have the attendance screen open (`src/teacher.js`'s `trackTeacherPresence`, `window._teacherPresenceChannel`); the Today tab subscribes to that same presence state to show the live dot (`src/admin.js`, `window._teacherPresenceViewerChannel`).
  - Both kinds of subscription are still governed by the same RLS policies as everything else — there's no separate, more permissive "realtime" access.

- **Not used anywhere in this app**: Supabase Storage (the app logo is hotlinked from the temple's own website, not stored in Supabase; nothing else uploads files/images), Edge Functions, `supabase.rpc()` calls from the client, and any social/OAuth sign-in provider.

## Data model highlights (for context, not exhaustive)

- `teacher_registrations` — pre-account record of every person who's registered, signed up or not.
- `pending_class_assignments` — a class assignment made before the person has an account yet; converted to a real `class_teachers` row automatically on signup.
- `class_teachers` — many-to-many between classes and teachers.
- `students.class_id` / `students.optional_class` — grade homeroom vs. optional class rostering.
- `class_groups` / `students.class_group_id` — sub-groups within a class.
- `attendance` / `teacher_attendance` — daily records, one set per class per day.
- `class_lesson_notes` — one note per class per day.
- `class_sessions` — the calendar of attendance-open dates, holidays, and events.
- `teacher_availability` — a teacher's self-reported availability per date.
- `kudos_categories` / `kudos_points` (formerly `recognition_*`) — append-only log of point awards, not a running total, so history is preserved.
- `smile_box_entries` — the shared "what made your day" wall.
- `volunteer_hours` — submitted/accepted hours for non-grade teams.
- `audit_log` — the audit trail.

## Known gaps / manual-only steps

- No in-app form to add a `teacher_registrations` row — done via direct SQL.
- No in-app way to promote someone to Admin — done via direct SQL.
- Add-student form exists in code but is currently hidden.
- **Admin-sent invite isn't actually available yet** — `auth.js` and `set-password.js` both reference `data_import/invite_teachers.mjs` as the tool an admin would run to send one, but that file doesn't exist in the repo. Same situation as `DECISIONS.md`, referenced repeatedly in code comments (`nav.js`, `audit.js`) but not present. Today, the only two ways someone gets into their account are self-signup and the direct `set_user_password.mjs` script.
