/**
 * config.js
 *
 * Single place for the app's branding -- name and logo -- so changing
 * either one later is a one-file edit instead of hunting through
 * index.html, vite.config.js, and every place that shows a title.
 *
 * Used by:
 *  - main.js: sets the browser tab title and the header text/logo at
 *    runtime, from this file.
 *  - vite.config.js: feeds the PWA install manifest (home screen name,
 *    splash screen) -- imported directly, since vite.config.js also runs
 *    as a plain Node module at build time.
 *
 * The logo is currently hotlinked straight from the temple's own site
 * (https://www.hindutemplestlouis.org/services/) rather than a copy
 * stored in this repo -- simplest way to stay in sync if they update it.
 * To use a locally-hosted file instead (e.g. a higher-resolution export,
 * or if hotlinking ever becomes unreliable), drop the image in `public/`
 * and change APP_LOGO_URL to its local path (e.g. '/htyg-logo.png').
 *
 * Also holds every user-facing message string used across the app --
 * auth/login flow, teacher dashboard status messages, and every admin
 * dashboard toast/hint/empty-state string (see ADMIN_MESSAGES) -- kept
 * here for the same reason as the branding above: one place to edit
 * wording whenever it needs to change, instead of hunting through the
 * component that renders it.
 */

export const APP_NAME = 'HTYG - Attendance System'

// Shown under the home-screen icon when installed as a PWA -- kept short
// since phone launchers truncate long names.
export const APP_SHORT_NAME = 'HTYG Attendance'

export const APP_LOGO_URL = 'https://www.hindutemplestlouis.org/services/wp-content/uploads/2021/05/cropped-Logo-1-270x270.png'

// Header accent / PWA splash-screen theme color.
export const THEME_COLOR = '#4f46e5'

// Shown to a teacher on the "Take Attendance" tab when today isn't open
// for attendance -- see teacher.js's renderNoClassMessage and
// data_import/15_class_sessions.sql. `closed` is used when today has a
// class_sessions row but it's marked not-an-attendance-day (a holiday, or
// a special event the admin hasn't opened); `notScheduled` is used when
// there's no row for today at all. `contactAdmin` is appended after
// whichever reason applies.
export const NO_CLASS_MESSAGES = {
  closed: (label) => `Today is marked "${label}" on the calendar -- not an attendance day.`,
  notScheduled: 'No class is scheduled for today.',
  contactAdmin: 'If this is a mistake, ask your admin to open today\'s date from Calendar panel.'
}

// Small always-visible footer credit, shown on every screen (login,
// admin, teacher) via the app shell in index.html. Change the name/
// wording here whenever needed -- no need to touch index.html or main.js.
export const APP_FOOTER_TEXT = 'This application was developed by Aadyashakti Joshi, HTYG student, in service to HTYG'

// Shown on a signed-in user's screen when they have no `profiles` row yet
// (e.g. right after a fresh signup, before data_import/08c_sync_teacher_profiles.sql
// has synced them) -- see main.js's handleAuthState.
export const PENDING_SETUP_MESSAGE = {
  heading: 'Almost there!',
  body: 'Your account is signed in, but not fully set up yet. Ask your admin to finish setting up your profile, then refresh this page.'
}

// Shown on a teacher's dashboard when they have zero classes assigned at
// all (a different situation than NO_CLASS_MESSAGES below, which is about
// *today* specifically) -- see teacher.js's renderTeacherDashboard.
export const NO_CLASS_ASSIGNED_MESSAGE = 'No class assigned to you yet. Contact your admin.'

// A student with more absences than this within the Records tab's
// selected date range shows up on the "Needs Follow-up" list -- see
// admin.js's loadRecordsRange. E.g. 2 means "more than 2 absences" (3+)
// triggers it. One place to tune how sensitive that list is.
export const RECORDS_FOLLOW_UP_ABSENCE_THRESHOLD = 2

// Word cap on the "what did you teach today" note a teacher can add
// alongside attendance (see data_import/30_class_lesson_notes.sql and
// teacher.js's renderAttendanceForm). Enforced live in the UI (the submit
// button disables past this) -- the database only backstops it with a
// generous character cap, since counting words exactly in SQL isn't worth
// the trouble.
export const LESSON_NOTE_MAX_WORDS = 500

// Password rules, enforced by password-rules.js's validatePassword() and
// shown as placeholder hints in auth.js and set-password.js.
export const PASSWORD_RULES = {
  minLength: 8,
  maxSpecialChars: 1
}

// Messages for the same validatePassword() checks -- kept alongside
// PASSWORD_RULES since the wording references those numbers directly.
export const PASSWORD_VALIDATION_MESSAGES = {
  tooShort: (min) => `Password must be at least ${min} characters.`,
  tooManySpecialChars: (max) => `Password can have at most ${max} special character${max === 1 ? '' : 's'}.`,
  mismatch: "Passwords don't match."
}

// Every message shown by auth.js's "Set / Reset Password" form -- see
// that file's header comment for what each account-status case means.
export const AUTH_MESSAGES = {
  accountCreatedCanSignIn: 'Account created! You can sign in with that password now -- ask your admin to finish setting up your class assignment if this is your first time in.',
  accountCreatedNeedsConfirmation: 'Account created! Check your inbox for a confirmation email -- click the link there, then you can sign in with that password.',
  pendingInvite: 'You already have a pending invite for this email -- check your inbox for a link to finish setting up your account (just sent again).',
  alreadyRegistered: "You already have an account with this email -- use \"Forgot password?\" instead to sign back in.",
  resetLinkGeneric: 'If that email has an account, a reset link is on its way.'
}

// Every toast, hint, and empty-state string on the admin dashboard --
// grouped by which tab in admin.js uses it. `(err)` params take the
// Supabase error object directly (so `.message` stays in one place here,
// not repeated at every call site); template functions otherwise take
// whatever piece of data the wording needs.
export const ADMIN_MESSAGES = {
  today: {
    // Appended to the "Today's Attendance" heading so the admin sees
    // at a glance why teachers might not have an attendance form up.
    statusNote: (session) => session
      ? ` — ${session.label}${session.is_attendance_day ? '' : ' (attendance closed)'}`
      : ' — no class scheduled today',
    noClassesCreatedYet: 'No classes created yet.',
    // The Pending Volunteer Hours card above the status board -- see
    // admin.js's renderPendingVolunteerHoursCard. Only ever shown when
    // there's actually something pending; renders nothing otherwise.
    pendingVolunteerHeading: (n) => `${n} volunteer hour submission${n === 1 ? '' : 's'} waiting for approval`,
    pendingVolunteerHint: "Submitted by a team's teacher -- review and accept or edit it on the Volunteer Hours tab.",
    pendingVolunteerReviewLabel: 'Review',
    attendanceSubmitted: (className) => `${className} attendance submitted!`,
    // The review panel that opens when the admin clicks an already-
    // submitted class's status badge -- see admin.js's
    // toggleClassReviewPanel and data_import/19_admin_attendance_management.sql.
    loadingReview: 'Loading...',
    errorLoadingReview: 'Error loading attendance for review.',
    reviewStudentsHeading: 'Student Attendance',
    reviewTeachersHeading: 'Teacher Attendance',
    reviewNoStudents: 'No student records for today.',
    saveChangesLabel: 'Save Changes',
    reviewSaved: 'Changes saved',
    reviewSaveError: 'Couldn\'t save changes',
    rejectLabel: 'Reject for Rework',
    // Second-click confirmation text -- no native confirm() dialog, same
    // as the rest of this app; the button itself swaps to this label as
    // the "are you sure" step before the flag actually gets set.
    rejectConfirmLabel: 'Click again to confirm',
    rejectError: 'Couldn\'t reject for rework',
    // Rejecting flags the existing rows rather than deleting them (see
    // data_import/22_attendance_rework_flag.sql), so the teacher's original
    // submission is still there for them to fix, not gone.
    rejectedForRework: 'Rejected -- teacher can fix and resubmit',
    reworkBadge: 'Needs Rework',
    // Shown in the review modal when the class is currently flagged --
    // reminds the admin they're looking at a submission still waiting on
    // the teacher, not a fresh one.
    reworkPendingNotice: 'Flagged for rework -- waiting on the teacher to fix and resubmit.',
    // The "what did you teach today" note, shown in the review modal as a
    // chat bubble -- see data_import/30_class_lesson_notes.sql and
    // teacher.js's lesson-note textarea on the attendance form itself.
    lessonNoteHeading: 'What was taught today',
    lessonNoteEmpty: 'No note left for today.'
  },
  calendar: {
    hint: 'Teachers only see the attendance form on a date marked "Attendance Open" below. Edit a date\'s label or type, toggle it open/closed, or add a date outside the regular calendar with the form at the bottom.',
    noDatesInSection: 'No dates in this section.',
    couldntLoad: (err) => `Couldn't load class calendar: ${err.message}`,
    dateUpdated: 'Date updated',
    couldntUpdateDate: (err) => `Couldn't update date: ${err.message}`,
    attendanceOpenedForDate: 'Attendance opened for that date',
    attendanceClosedForDate: 'Attendance closed for that date',
    dateAdded: 'Date added',
    couldntAddDate: (err) => `Couldn't add date: ${err.message}`
  },
  classes: {
    hint: 'Drag a teacher onto a class to give them their first assignment -- once assigned, they drop off this list. To also give a class to someone who\'s already teaching elsewhere, use that class\'s "+ Add teacher" dropdown instead. "(pending)" means they haven\'t signed up for an account yet -- the assignment takes effect automatically once they do. Someone new who hasn\'t been assigned anywhere yet shows up twice, once as Teacher and once as Assistant -- drag whichever role fits (Assistant is the restricted role for minors and new volunteers: attendance for their own class plus Smile Box, no volunteer hours); the other copy disappears once you do, and every later class for that person keeps the same role.',
    noClassesInGroupYet: 'No classes in this group yet',
    unassignedBadge: 'Unassigned',
    noTeachersFoundHint: 'No teachers found -- check that data_import/08_teacher_profile_fields.sql and 08b_teacher_registrations_data.sql have been run',
    everyTeacherAssigned: 'Every teacher already has a class assigned',
    couldntLoad: (label, err) => `Couldn't load ${label}: ${err.message}`,
    teacherAssignedPending: 'Teacher assigned (takes effect once they sign up)',
    teacherAssigned: 'Teacher assigned',
    alreadyAssigned: 'Already assigned to this class',
    couldntAssignTeacher: (err) => `Couldn't assign teacher: ${err.message}`,
    teacherRemoved: 'Teacher removed',
    couldntRemoveTeacher: (err) => `Couldn't remove teacher: ${err.message}`
  },
  students: {
    searchPlaceholder: 'Search students…',
    noStudentsMatchFilter: 'No students match this filter.',
    // Shown just above the list, so narrowing the filters down doesn't
    // require scrolling to the bottom to see how many matched. Says the
    // total only once everything is unfiltered (shown === total) since
    // "42 of 42" is just noise at that point.
    resultsCount: (shown, total) => shown === total ? `${total} student${total === 1 ? '' : 's'}` : `${shown} of ${total} student${total === 1 ? '' : 's'}`
  },
  records: {
    errorLoadingSummaries: 'Error loading summaries.',
    errorLoadingRecords: 'Error loading records.',
    noRecordsForRange: 'No records for this date range.',
    // Shown for a multi-day range instead of a full day-by-day,
    // name-by-name list -- see admin.js's loadRecordsRange and
    // RECORDS_FOLLOW_UP_ABSENCE_THRESHOLD above.
    followUpHeading: 'Needs Follow-up',
    followUpNone: "Nobody's missed more than a couple times in this range — great turnout!",
    followUpStat: (missed, total) => `Missed ${missed} of ${total}`,
    perfectAttendanceHeading: 'Perfect Attendance',
    noPerfectAttendance: 'No one has perfect attendance in this range yet.',
    perfectAttendanceStat: (total) => `Present all ${total} time${total === 1 ? '' : 's'}`,
    // Records tab's "Backfill Attendance" panel (see admin.js's
    // wireBackfillPanel and openBackfillModal) -- lets an admin enter
    // attendance for a class + past date directly, for a day a teacher
    // never submitted at all (so there's nothing for the Today tab's
    // review/reject-for-rework flow to act on -- that only ever covers
    // today, and only covers a day that already has at least one row).
    // Distinct from that flow: this one builds its rows from the class's
    // full current roster, not from whatever attendance rows already
    // exist, so a day with zero submissions still shows every
    // student/teacher to mark rather than an empty list.
    backfill: {
      openButtonLabel: '+ Backfill Attendance',
      heading: 'Backfill Attendance',
      hint: "For a class and date a teacher never submitted (or only partly did) -- pick both below to enter it now on their behalf. Anyone who already has a record for that date keeps it as their starting point; everyone else defaults to Present, same as a fresh form.",
      classLabel: 'Class',
      classPlaceholder: 'Select a class',
      dateLabel: 'Date',
      loadButtonLabel: 'Load',
      pickClassAndDate: 'Pick a class and a date first.',
      futureDateError: "Can't backfill a date in the future.",
      loadingRoster: 'Loading roster…',
      errorLoadingRoster: (err) => `Couldn't load that class's roster: ${err.message}`,
      noRosterForClass: 'This class has no students or teachers assigned yet.',
      saveButtonLabel: 'Save Attendance',
      saved: 'Attendance saved',
      saveError: "Couldn't save attendance"
    }
  },
  teacherAttendance: {
    // See data_import/18_teacher_attendance.sql -- teacher (not student)
    // attendance, submitted alongside student attendance from
    // teacher.js's "Take Attendance" tab.
    errorLoading: 'Error loading teacher attendance.',
    noRecordsForRange: 'No teacher attendance records for this date range.',
    // Shown next to a teacher's name when they also marked attendance for
    // at least one other class on the same date (see admin.js's
    // loadTeacherAttendanceRange) -- so a teacher's name appearing more
    // than once that day (once per class, e.g. a grade homeroom plus
    // Gita) reads as "one teacher covering two classes today", not as a
    // stray-looking repeat.
    alsoTeaching: (classNames) => `also taught ${classNames.join(', ')} today`
  },
  // Records tab's "Lesson Notes" subsection (see admin.js's
  // loadLessonNotesRange and data_import/30_class_lesson_notes.sql) -- the
  // only place an admin can look back at what a class's teacher wrote they
  // covered on a past date, since the Today tab's review modal only ever
  // shows the current date's note live.
  lessonNotesRecords: {
    errorLoading: 'Error loading lesson notes.',
    noRecordsForRange: 'No lesson notes for this date range.',
    // A note's teacher_id can be null (e.g. the profile was later
    // deleted) -- shown instead of a blank name in that rare case.
    unknownTeacher: 'Unknown teacher',
    byTeacher: (name) => `by ${name}`,
    // Distinct wording from today.lessonNoteEmpty ("No note left for
    // today.") since this can be any past date, not necessarily today.
    noNote: 'No note left.'
  },
  // Records tab's second subsection (see admin.js's
  // loadVolunteerHoursRecordsRange) -- a read-only, date-range-filtered
  // history of ACCEPTED volunteer hours across every team. Anything still
  // pending isn't a "record" yet by this app's convention (see
  // volunteerHours.pendingHint above) -- that lives on the Volunteer Hours
  // tab (and the Today tab's pending card) until an admin accepts it.
  volunteerHoursRecords: {
    errorLoading: (err) => `Couldn't load volunteer hour records: ${err.message}`,
    noRecordsForRange: 'No accepted volunteer hours in this date range.'
  },
  // Records tab's "Smile Box" subsection (see admin.js's loadSmileBoxRange
  // and data_import/45_smile_box.sql) -- a read-only, date-range-filtered
  // mirror of the same shared wall every teacher already sees on their own
  // Smile Box tab (see teacher.js's renderSmileBoxTab and SMILE_BOX_MESSAGES
  // below).
  smileBoxRecords: {
    errorLoading: (err) => `Couldn't load Smile Box entries: ${err.message}`,
    noRecordsForRange: 'No Smile Box entries in this date range.',
    unknownTeacher: 'Unknown teacher',
    byTeacher: (name) => `— ${name}`,
    aboutSubject: (name) => `About ${name}`,
    generalLabel: 'Not about anyone specific'
  },
  volunteerHours: {
    // See data_import/23_volunteer_hours.sql and teacher.js's
    // renderLogHoursTab for the submitting side -- admin.js's
    // renderVolunteerHoursTab only ever accepts or overrides what a
    // team's teacher submitted, same as the Today tab's review modal does
    // for attendance; there's no free-form "add a new entry" here by
    // design (see DECISIONS.md).
    selectTeamPlaceholder: 'Select a team',
    noTeamSelected: 'Pick a team above to see its volunteer hours.',
    noTeamsYet: 'No volunteer teams found -- run data_import/23_volunteer_hours.sql to flag the existing team classes.',
    couldntLoad: (err) => `Couldn't load volunteer hours: ${err.message}`,
    pendingHeading: 'Pending Review',
    pendingHint: "Submitted by a team's teacher, waiting on you, across every team -- Accept as-is, or Edit to correct it first (editing also accepts it).",
    loadingPending: 'Loading pending hours…',
    noPendingAnywhere: 'Nothing pending -- all submitted volunteer hours have been reviewed.',
    acceptLabel: 'Accept',
    accepted: 'Accepted',
    saveLabel: 'Save',
    cancelEditButton: 'Cancel',
    invalidHours: 'Enter hours greater than 0.',
    updated: 'Hours updated',
    couldntSave: (err) => `Couldn't save: ${err.message}`,
    totalsHeading: 'Totals by Student',
    noTotalsYet: 'No accepted hours for this team yet.',
    totalStat: (hours) => `${hours} hr${hours === 1 ? '' : 's'}`,
    activityHeading: 'Activity Log',
    noActivityYet: 'No accepted entries yet.',
    notePlaceholder: 'Note (optional)',
    editLabel: 'Edit',
    deleteLabel: 'Delete',
    deleteConfirmLabel: 'Click again to confirm',
    deleted: 'Entry deleted',
    couldntDelete: (err) => `Couldn't delete: ${err.message}`
  },
  activity: {
    // See data_import/24_audit_log.sql and audit.js's logAudit -- a
    // read-only trail of every decision an admin or teacher has made that
    // changed stored data, filterable the same way the Records tab's
    // date-range filter works, plus a who-did-it filter (this app only
    // has the two roles).
    hint: 'Every decision that changed stored data -- attendance reviews, volunteer hours, class/calendar edits -- shown here with who did it and when. Read-only: nothing on this tab can be edited or undone from here.',
    allActors: 'Everyone',
    couldntLoad: (err) => `Couldn't load activity: ${err.message}`,
    noActivityForRange: 'No activity in this date range.'
  },
  // See data_import/27_teacher_availability.sql and teacher.js's Calendar
  // tab (where a teacher actually sets this) -- this tab only reads it,
  // for a single selected date at a time, next to the classroom(s) each
  // teacher is normally assigned to via class_teachers.
  teacherAvailability: {
    hint: 'Who\'s planning to be there for a given date -- one card per class, same board as Today, with each assigned teacher\'s availability instead of an attendance status. Every teacher defaults to available -- only someone who\'s marked themselves Unavailable needs your attention. Set by each teacher on their own Calendar tab, changeable any time; read-only here.',
    dateSelectLabel: 'Date:',
    noUpcomingDates: 'No dates on the calendar yet -- add one from the Calendar tab.',
    statusAvailable: 'Available',
    statusUnavailable: 'Unavailable',
    couldntLoad: (err) => `Couldn't load teacher availability: ${err.message}`,
    summaryStat: (available, unavailable) => `${available} available · ${unavailable} unavailable`
  },
  // "Class Groups" tab (see admin.js's renderClassGroupsTab and
  // data_import/85_class_groups_generalized.sql) -- lets an admin split any
  // class into any number of named groups and assign students into them.
  // A class with no groups defined is completely unaffected everywhere
  // else in the app; a class that DOES have groups shows a group picker
  // instead of one roster on the teacher's own Take Attendance tab (see
  // teacher.js's renderGroupPicker), tracking each group's submission
  // independently.
  classGroups: {
    hint: "Split a class into groups you define -- once a class has at least one group, its teacher is asked which group they're taking attendance for, and each group is tracked (and can be submitted) separately. Most classes don't need this at all; leave them with no groups and nothing changes for them.",
    classLabel: 'Class',
    classPlaceholder: 'Select a class',
    loadError: (err) => `Couldn't load: ${err.message}`,
    groupsHeading: 'Groups',
    noGroupsYet: 'No groups created for this class yet -- every student shows up on one shared roster, same as before.',
    addGroupPlaceholder: 'New group name (e.g. "Group 1")',
    addGroupButton: '+ Add Group',
    addGroupNameRequired: 'Enter a name for the new group.',
    addGroupDuplicate: 'This class already has a group with that name.',
    addGroupError: (err) => `Couldn't create group: ${err.message}`,
    groupAdded: (name) => `"${name}" added`,
    renameButton: 'Rename',
    renameSaveButton: 'Save',
    renameCancelButton: 'Cancel',
    renameNameRequired: 'Enter a name.',
    renameError: (err) => `Couldn't rename: ${err.message}`,
    renamed: 'Renamed',
    deleteButton: 'Delete',
    deleteConfirmButton: 'Click again to confirm',
    deleteError: (err) => `Couldn't delete: ${err.message}`,
    // Reassures rather than warns -- a deleted group's students aren't
    // lost, just ungrouped again (see the class_group_id foreign key's ON
    // DELETE SET NULL), same as before that group ever existed.
    deleted: (name) => `Deleted "${name}" -- its students are now ungrouped, not removed from the class`,
    rosterHeading: 'Assign Students',
    rosterHint: "Pick a group for each student, or leave them Ungrouped. Saves as you go -- there's no separate save step.",
    ungroupedOption: 'Ungrouped',
    noStudentsInClass: 'This class has no students yet.',
    assignmentSaved: 'Saved',
    assignmentError: (err) => `Couldn't save: ${err.message}`
  }
}

// Every message on the teacher dashboard's "Log Hours" tab -- see
// teacher.js's renderLogHoursTab. Separate from volunteerHours above
// (that's the admin's accept/override side of the same feature).
export const LOG_HOURS_MESSAGES = {
  teamSelectLabel: 'Team:',
  dateLabel: 'Date:',
  hoursLabel: 'Hours (for everyone selected):',
  notePlaceholder: 'Note (required)',
  searchPlaceholder: 'Search students…',
  allGradesOption: 'All Grades',
  selectAllVisible: 'Select All',
  clearSelection: 'Clear',
  studentsHeading: 'Select Students',
  noEligibleStudents: 'No eligible students found.',
  // Shown in the available list when a search/grade filter matches no one
  // -- distinct from noEligibleStudents (nobody eligible at all) so it's
  // clear this is about the filter, not the roster.
  noAvailableStudents: 'No one matches -- try a different search or grade, or clear the filter.',
  // Heading above the Selected box, and its own empty state before anyone's
  // been picked yet -- see renderLogHoursTab/wireLogHoursForm.
  selectedHeading: (count) => `Selected (${count})`,
  noSelectedStudents: 'Nobody selected yet -- tap a name above to add them here.',
  // "Volunteer Hours" everywhere the app names this feature to a user --
  // the tab label (see teacher.js's teacherTabs), this button, and the
  // toast below all agree. "Log"/"logging" still shows up as a plain verb
  // ("logging hours", "Logged for N students") since that just describes
  // the action, not a second competing name for the feature.
  submitButton: (count) => count > 0 ? `Log Volunteer Hours for ${count} Student${count === 1 ? '' : 's'}` : 'Log Volunteer Hours',
  noStudentsSelected: 'Select at least one student.',
  invalidHours: 'Enter hours greater than 0.',
  noteRequired: 'Add a note before logging hours.',
  submitError: (message) => `Error: ${message}`,
  submitted: (count) => `Volunteer hours logged for ${count} student${count === 1 ? '' : 's'} -- waiting on admin review.`,
  // Attendance-percentage badge shown under each student's name in the
  // picker -- see teacher.js's fetchAttendancePercentages/rowHtml. Gives a
  // teacher enough to decide whether to offer this student a
  // volunteer-hours opportunity without leaving this tab. `overallPct`/
  // `last30Pct` are null when there's no attendance on record for that
  // window yet (see fetchAttendancePercentages's doc comment).
  attendancePercentLabel: (overallPct, last30Pct) => {
    if (overallPct === null) return 'No attendance on record yet'
    const last30Text = last30Pct === null ? 'none in last 30 days' : `${last30Pct}% last 30 days`
    return `${overallPct}% overall · ${last30Text}`
  }
}

// Every message on the teacher dashboard's "Take Attendance" tab -- see
// teacher.js's renderAttendanceForm.
export const TEACHER_MESSAGES = {
  // The Available/Unavailable toggle added to each upcoming open date on
  // the teacher's own Calendar tab -- see teacher.js's renderTeacherCalendar
  // and data_import/27_teacher_availability.sql. Saves immediately on
  // click (no separate submit button), and can be changed again any time.
  availability: {
    hint: 'You\'re marked available by default for each upcoming date -- only switch to Unavailable if you won\'t be there (or back to Available any time your plans change).',
    markAvailable: 'Available',
    markUnavailable: 'Unavailable',
    savedAvailable: 'Marked available',
    savedUnavailable: 'Marked unavailable',
    couldntSave: (err) => `Couldn't save: ${err.message}`
  },
  attendanceForm: {
    alreadySubmitted: 'Attendance already submitted for today.',
    noStudentsInClass: 'No students in this class yet.',
    // Live running count shown just above the Submit button while marking
    // attendance -- lets a teacher cross-check "that sounds about right"
    // against how many kids are actually in the room before submitting,
    // rather than only spotting a mistake after the fact on the locked
    // "already submitted" view. Same string used in both places (see
    // teacher.js's updateAttendanceSummary and renderAlreadySubmittedMessage).
    // Returns HTML (the counts wrapped in <strong>), not plain text -- both
    // call sites render it via innerHTML, and the numbers are what a
    // teacher actually needs to read at a glance, not the word "present".
    presentCount: (present, total) => `<strong>${present}</strong> of <strong>${total}</strong> present`,
    // Heading above the co-teacher Present/Absent toggles -- only shown
    // when the class has more than one teacher assigned.
    coTeacherHeading: 'Co-Teacher Attendance',
    submitError: (message) => `Error: ${message}`,
    attendanceSubmitted: 'Attendance submitted!',
    // Shown above the form when an admin has rejected today's submission
    // for rework (see data_import/22_attendance_rework_flag.sql) -- the
    // form below is pre-filled with what was already submitted, not blank,
    // so this explains why a "Submit Attendance" button reappeared.
    reworkNotice: 'An admin sent this back for rework. Fix whatever was wrong below and resubmit -- everything else is still filled in as you left it.',
    submitLabel: 'Submit Attendance',
    resubmitLabel: 'Resubmit Attendance',
    reworkSubmitted: 'Updated and resubmitted!',
    // The read-only view of today's submitted attendance, shown on the
    // locked "already submitted" screen -- see teacher.js's
    // renderAlreadySubmittedMessage -- plus the button that reopens it for
    // a teacher to fix a mistake themselves, without needing an admin to
    // flag it for rework first (see data_import/56_teachers_self_edit_attendance.sql).
    submittedAttendanceHeading: "Today's Attendance",
    editAttendanceLabel: 'Edit Attendance',
    // Shown above the form instead of reworkNotice when a teacher opened
    // this themselves (via editAttendanceLabel above) rather than an admin
    // sending it back -- same editable form either way, just a different
    // reason to be looking at it.
    selfEditNotice: 'Editing today\'s attendance. Make your changes and hit Save.',
    saveChangesLabel: 'Save Changes',
    attendanceUpdated: 'Attendance updated!',
    // The "what did you teach today" note -- optional, submitted together
    // with attendance (no separate save step/screen of its own) and shown
    // back as a chat bubble once locked, see data_import/30_class_lesson_notes.sql.
    lessonNoteLabel: 'What did you teach today? (optional)',
    lessonNotePlaceholder: 'Type a quick note for the admin -- topics covered, activities, anything worth flagging...',
    lessonNoteCounter: (words, max) => `${words} / ${max} words`,
    lessonNoteOverLimit: (max) => `Keep it under ${max} words to submit -- trim it down a bit.`,
    // Editing the note directly, any time after it's submitted -- unlike
    // attendance itself, a note is low-stakes enough that this doesn't need
    // an admin to reject the submission for rework first (see
    // data_import/31_class_lesson_notes_editable.sql). Shown under the
    // locked "already submitted" view, next to the note bubble.
    lessonNoteEmpty: 'No note left for this class today.',
    editNoteLabel: 'Edit note',
    addNoteLabel: '+ Add a note',
    saveNoteLabel: 'Save',
    cancelNoteLabel: 'Cancel',
    noteSaved: 'Note saved',
    couldntSaveNote: (message) => `Couldn't save note: ${message}`,
    // Shown for a class with at least one admin-defined group (see
    // data_import/85_class_groups_generalized.sql's class_groups table and
    // admin.js's Class Groups tab) instead of jumping straight to the
    // roster: any teacher assigned to the class can take attendance for
    // any group, on any given day, so this asks which one before showing a
    // roster -- see teacher.js's renderGroupPicker. A class with no groups
    // defined at all never shows this; existing single-roster classes are
    // completely unaffected.
    groupPicker: {
      heading: 'Which group are you taking attendance for?',
      hint: "This class is split into groups. Each one is tracked and submitted separately, so pick the one you're actually taking today -- if the other group still needs to be done, whoever's got them can do it separately, any time.",
      // Real groups get their name straight from data_import/85_class_
      // groups_generalized.sql's class_groups table (an admin can call
      // them anything, from the Class Groups tab -- see admin.js's
      // renderClassGroupsTab) -- only the pseudo-group of students who
      // haven't been assigned a real one yet uses a fixed label here.
      ungroupedLabel: 'Ungrouped Students',
      // Deliberately not hidden: a class that's only partly assigned groups
      // (see the migration file above) still needs every student's
      // attendance taken somewhere, so the ungrouped ones get their own
      // card here rather than silently dropping out of both real groups.
      ungroupedCardHint: (n) => `${n} student${n === 1 ? " hasn't" : " haven't"} been assigned Group 1 or 2 yet -- ask your admin when you get a chance. Their attendance still needs to be taken, so they're listed here separately for now.`,
      studentCount: (n) => `${n} student${n === 1 ? '' : 's'}`,
      statusSubmitted: (name) => name ? `Submitted by ${name} ✓` : 'Submitted ✓',
      statusNeedsRework: 'Sent back for rework',
      statusNotSubmitted: 'Not yet submitted',
      openButtonLabel: 'Take Attendance',
      backToGroupsLabel: '← Switch group'
    }
  }
}

// Every message on the teacher dashboard's "Smile Box" tab -- see
// teacher.js's renderSmileBoxTab/wireSmileBoxForm and
// data_import/45_smile_box.sql. The admin Records tab's read-only mirror
// of the same data uses smileBoxRecords (inside ADMIN_MESSAGES above)
// instead, since its wording is admin-facing rather than a teacher
// composing their own post.
export const SMILE_BOX_MESSAGES = {
  intro: 'Share something nice about a co-teacher or student -- what made your day today? Every teacher can see what gets posted here.',
  searchPlaceholder: 'Search for a name (optional)…',
  // Shown under the search box when nothing in the roster matches what's
  // typed -- reassurance, not an error: see wireSmileBoxForm's doc comment
  // ("should work even when name is not there" was an explicit
  // requirement) -- whatever's typed is still saved as free text either way.
  noMatches: "No match -- that's fine, the name you typed is still saved as-is.",
  // Shown above the message box: either the picked person's name, or this,
  // whenever no pick has been made (the default, and also what an empty
  // search box means).
  generalLabel: 'Not about anyone specific',
  selectedLabel: (name) => `About: ${name}`,
  messagePlaceholder: 'What made your day?',
  submitButton: 'Post to Smile Box',
  messageRequired: 'Write something before posting.',
  submitError: (message) => `Error: ${message}`,
  posted: 'Posted to the Smile Box!',
  wallHeading: 'Recent Smiles',
  empty: 'No Smile Box entries yet -- be the first to share something nice!',
  loadError: (err) => `Couldn't load Smile Box: ${err.message}`,
  aboutLabel: (name) => `About ${name}`
}
