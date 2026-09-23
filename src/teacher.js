/**
 * teacher.js
 *
 * Renders the teacher dashboard: taking daily attendance for the
 * teacher's assigned class(es), plus a read-only history view.
 *
 * Classes and teachers are many-to-many via the class_teachers join table
 * (see data_import/06_multi_teacher_classes.sql): a class can have more
 * than one teacher assigned, and any of them can mark attendance for all
 * of its students -- attendance is only guarded against being submitted
 * twice for the same (class, date), not per-teacher. A teacher can also be
 * linked to more than one class at once -- e.g. running "1st Grade" as
 * their homeroom and also teaching "Gita" on Saturdays. When a teacher has
 * more than one class, renderTeacherDashboard shows a class switcher above
 * the tab navigation so they can pick which one they're looking at; each
 * class tracks its own "already submitted today" status independently.
 *
 * A class is either a grade homeroom (its roster is every student whose
 * students.class_id points at it) or one of the optional Saturday classes,
 * Gita/Bhajan (its roster is every student whose students.optional_class
 * matches, regardless of their grade homeroom -- see
 * OPTIONAL_CLASS_CODE_BY_NAME in format.js). Either way, once a class has
 * a `.students` array attached, the rest of this file (attendance form,
 * submission, history) treats it the same.
 */

import { supabase } from './supabase.js'
import { toTitleCase, escapeHtml, OPTIONAL_CLASS_CODE_BY_NAME, GRADE_ORDER, VOLUNTEER_ELIGIBLE_GRADES } from './format.js'
import { todayStr, getSessionForDate } from './calendar.js'
import { NO_CLASS_MESSAGES, NO_CLASS_ASSIGNED_MESSAGE, TEACHER_MESSAGES, LOG_HOURS_MESSAGES, LESSON_NOTE_MAX_WORDS, SMILE_BOX_MESSAGES } from './config.js'
import { logAudit } from './audit.js'
import { renderNavDrawer } from './nav.js'

/**
 * Builds the "Welcome, <name>! <day, date, time>" banner shown at the top
 * of the teacher dashboard on every login, whether or not they have a
 * class assigned yet. The date/time is a snapshot of when the dashboard
 * was rendered (i.e. login time) -- it doesn't tick live.
 *
 * Pinned to Central Time (see calendar.js's todayStr for why) rather than
 * the device's own timezone, so this always agrees with what the rest of
 * the app considers "today" -- and shows the zone abbreviation (CDT/CST)
 * so that's visible rather than assumed.
 *
 * @param {string|null|undefined} fullName
 * @returns {string} HTML for the banner.
 */
function buildWelcomeBanner(fullName) {
  const dateTimeStr = new Date().toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  })
  return `
    <div class="welcome-banner">
      <h2>Welcome, ${fullName ? toTitleCase(fullName) : 'there'}!</h2>
      <p class="welcome-datetime">${dateTimeStr}</p>
    </div>
  `
}

/**
 * Entry point for the teacher view. Loads every class the teacher is
 * assigned to, renders a class switcher when there's more than one, and
 * shows the "Take Attendance" tab for the first class by default. If the
 * teacher has no class assigned at all, shows only the welcome banner and
 * a message -- no tabs, switcher, or attendance UI.
 *
 * A teacher's assignments split into two kinds that never mix on screen:
 * real attendance classes (a grade homeroom or an optional class like
 * Gita/Bhajan) and volunteer teams (`tracks_volunteer_hours` -- see
 * data_import/23_volunteer_hours.sql). Take Attendance/History and their
 * class switcher only ever operate on the former (attendanceClasses,
 * below); Log Hours only ever operates on the latter (volunteerTeams). A
 * volunteer team used to leak into the Take Attendance class switcher as
 * if it were an ordinary class -- since it has no real roster, that both
 * confused teachers about which button to press for what, and let them
 * submit an empty "attendance" for it, which crashed on the
 * teacher_attendance unique constraint the second time (see
 * DECISIONS.md). Splitting the two apart here is what keeps a teacher
 * from ever landing on the wrong workflow for what they're actually here
 * to do.
 *
 * A signed-in 'assistant' (see data_import/50_assistant_role.sql -- a
 * restricted role for a minor or a new volunteer) gets this exact same
 * dashboard, just with a trimmed tab set: no Log Hours, since that needs
 * to see every 6th-12th grade student across the whole program to log
 * hours for, not just their own class (see VOLUNTEER_ELIGIBLE_GRADES
 * above). Take Attendance, History, Smile Box and Calendar all stay,
 * since those are already scoped to (or independent of) their own class
 * at the database level -- this tab trim is a UI nicety on top of that
 * real protection, not the protection itself.
 *
 * @param {HTMLElement} container - DOM element to render the dashboard into.
 * @param {string} userId - Supabase auth user id of the signed-in teacher.
 * @param {string} [role] - 'teacher' (default) or 'assistant'.
 */
export async function renderTeacherDashboard(container, userId, role = 'teacher') {
  // Look up the signed-in teacher's name for the welcome banner
  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .single()
  const welcomeBannerHtml = buildWelcomeBanner(profile?.full_name)

  // Fetch every class this teacher is linked to via class_teachers (a
  // class can have more than one teacher, and a teacher can be linked to
  // more than one class). For a grade class this join also pulls its
  // roster via students.class_id; for an optional class (Gita, Bhajan)
  // that join comes back empty since those students' class_id points at
  // their grade homeroom instead -- handled just below. Also pulls the
  // class's own class_teachers + profiles so renderAttendanceForm knows
  // who the co-teacher(s) are for teacher-attendance marking (see
  // data_import/18_teacher_attendance.sql).
  const { data: links } = await supabase
    .from('class_teachers')
    .select('classes(*, students(*), class_teachers(teacher_id, profiles(full_name)), class_groups(id, name))')
    .eq('teacher_id', userId)

  const classes = (links || []).map(link => link.classes).filter(Boolean)

  // No class assigned yet: welcome banner plus a plain message -- still
  // no class switcher or attendance/history UI, but the read-only
  // calendar is shown to every registered teacher regardless of whether
  // they have a class yet, so it goes here too.
  if (!classes || classes.length === 0) {
    container.innerHTML = `
      ${welcomeBannerHtml}
      <p>${NO_CLASS_ASSIGNED_MESSAGE}</p>
      <div id="tab-content"></div>
    `
    renderTeacherCalendar(userId)
    return
  }

  // Optional classes get their roster from students.optional_class instead
  // of students.class_id, since a student stays in their grade homeroom
  // and separately opts into at most one of Gita/Bhajan. Do this for every
  // assigned class, not just the first, since a teacher can be assigned
  // both a grade class and an optional class at once.
  for (const cls of classes) {
    const optionalCode = OPTIONAL_CLASS_CODE_BY_NAME[cls.name]
    if (optionalCode) {
      const { data: optionalStudents } = await supabase
        .from('students')
        .select('*')
        .eq('optional_class', optionalCode)
      cls.students = optionalStudents || []
    }
  }

  const today = todayStr()

  // Whether today is actually open for attendance -- see
  // data_import/15_class_sessions.sql. No row at all, or a row with
  // is_attendance_day: false, both mean "don't show the attendance form
  // today"; renderActiveTab below shows a message instead in either case,
  // and the admin can open today from the admin dashboard's Calendar tab.
  const todaySession = await getSessionForDate(today)

  // Split this teacher's assignments into the two kinds that never mix on
  // screen -- see this function's doc comment above for why. `classes(*)`
  // already selects every column including `tracks_volunteer_hours`, so
  // no extra query is needed to tell them apart.
  const attendanceClasses = classes.filter(c => !c.tracks_volunteer_hours)
  const volunteerTeams = classes.filter(c => c.tracks_volunteer_hours)

  // Which attendance class and which tab are currently shown. Switching
  // either one re-renders #tab-content via renderActiveTab() below.
  // Defaults to Take Attendance when this teacher actually has an
  // attendance class; a volunteer-team-only teacher (no grade/optional
  // class at all) has no Take Attendance tab to default to (see
  // attendanceTabsHtml below), so they land on Log Hours instead -- unless
  // they're an assistant, who never gets a Log Hours tab at all (see this
  // function's doc comment above), so they'd land on Smile Box instead in
  // that same no-attendance-class edge case.
  let activeClassIndex = 0
  let activeTabName = attendanceClasses.length > 0
    ? 'attendance'
    : (role === 'assistant' ? 'smileBox' : 'logHours')

  // Only show the class switcher when it's actually needed -- most
  // teachers have exactly one attendance class -- and only ever list
  // attendance classes in it; a volunteer team is switched via Log
  // Hours's own team picker instead (see renderLogHoursTab), never here.
  const classSwitcherHtml = attendanceClasses.length > 1
    ? `<div class="class-switcher" id="class-switcher">${attendanceClasses
        .map((c, i) => `<button class="class-switch-btn${i === 0 ? ' active' : ''}" data-index="${i}">${c.name}</button>`)
        .join('')}</div>`
    : ''

  // Which tabs the class switcher actually applies to -- Take Attendance,
  // History, Insights and Kudos are the only four that read
  // activeClassIndex (see renderActiveTab below); Log Hours, Smile Box and
  // Calendar are each either class-independent or switched some other way
  // (see classSwitcherHtml's own doc comment above).
  const CLASS_SWITCHER_TABS = ['attendance', 'history', 'insights', 'kudos']

  // Take Attendance, History, Insights and Kudos only make sense when
  // this teacher has at least one real attendance class -- omitted entirely
  // (not just disabled) for a teacher assigned only to volunteer team(s),
  // since there'd be nothing for any of the four to show. Most teachers
  // have no volunteer team at all, so Log Hours only appears when
  // volunteerTeams is non-empty. Calendar always applies. Order matches
  // what the tab row always showed, with Insights added right after
  // History (attendance-derived) and Kudos right after that
  // (teacher-given points -- see data_import/86_recognition_categories_
  // and_points.sql, renamed to kudos_* by data_import/88_rename_
  // recognition_to_kudos.sql).
  const teacherTabs = [
    ...(attendanceClasses.length > 0 ? [{ key: 'attendance', label: 'Take Attendance' }] : []),
    // Labeled "Volunteer Hours" (not "Log Hours") to match the admin
    // dashboard's tab for the same feature -- same name on both screens,
    // even though the internal 'logHours' key (used only in code, never
    // shown) stays as-is. Never shown to an assistant -- see this
    // function's doc comment above for why.
    ...(volunteerTeams.length > 0 && role !== 'assistant' ? [{ key: 'logHours', label: 'Volunteer Hours' }] : []),
    ...(attendanceClasses.length > 0 ? [{ key: 'history', label: 'History' }] : []),
    ...(attendanceClasses.length > 0 ? [{ key: 'insights', label: 'Insights' }] : []),
    ...(attendanceClasses.length > 0 ? [{ key: 'kudos', label: 'Kudos' }] : []),
    // Always shown, same as Calendar -- posting/reading Smile Box entries
    // has nothing to do with which class (if any) a teacher is assigned to.
    { key: 'smileBox', label: 'Smile Box' },
    { key: 'calendar', label: 'Calendar' }
  ]

  // Render the welcome banner, class switcher (if any), and drawer nav
  // (see nav.js) -- whichever of Take Attendance/Log Hours applies by
  // default (see activeTabName above) is what the drawer opens on.
  container.innerHTML = `
    ${welcomeBannerHtml}
    ${classSwitcherHtml}
    <div id="nav-container"></div>
    <div id="tab-content"></div>
  `

  // Renders whichever tab is currently active for the currently selected
  // attendance class. "Already submitted today" is looked up fresh each
  // time since it's specific to (class, date) and each class tracks it
  // independently.
  async function renderActiveTab() {
    // Always tear down any presence broadcast from whatever was rendered
    // before this call -- switching tabs, switching classes, or landing
    // back on 'attendance' for a *different* class should all stop
    // whatever was being broadcast previously. Re-established below, only
    // when actually on the attendance tab with the form showing (see
    // trackTeacherPresence's own doc comment for why the scope is this
    // narrow).
    cleanupTeacherPresenceChannel()

    // Only visible on the two tabs that actually use it -- see
    // CLASS_SWITCHER_TABS above. A no-op when there's just one attendance
    // class (classSwitcherHtml rendered nothing, so this element doesn't
    // exist at all).
    document.getElementById('class-switcher')?.classList.toggle('hidden', !CLASS_SWITCHER_TABS.includes(activeTabName))

    if (activeTabName === 'attendance') {
      // Guarded even though the tab button itself is never rendered
      // without an attendance class -- defensive, not reachable in
      // normal use.
      if (attendanceClasses.length === 0) return
      const myClass = attendanceClasses[activeClassIndex]
      // Not an attendance day (or nothing scheduled at all) -- show why
      // instead of the form. History is unaffected, since past records
      // don't depend on today's calendar status.
      if (!todaySession || !todaySession.is_attendance_day) {
        renderNoClassMessage(myClass, today, todaySession)
        return
      }
      // Fetch both tables' existing rows for today up front -- not just
      // whether any exist. If an admin has flagged this submission for
      // rework (see data_import/22_attendance_rework_flag.sql), the form
      // needs each student's and co-teacher's current status to pre-fill
      // with, and each row's id to update in place on resubmit, rather
      // than just a yes/no "already submitted".
      // Also fetch today's lesson note for this class, if one was already
      // written (see data_import/30_class_lesson_notes.sql) -- needed both
      // to show it back once locked, and to pre-fill the textarea on a
      // rework resubmit. `.maybeSingle()` since a not-yet-submitted day
      // simply has no row yet, which isn't an error here. Just `note` --
      // nothing here needs the row's id, since every write to this table
      // upserts by (class_id, date) instead of by id (see this file's
      // submit handler and renderLessonNoteEditForm).
      // Also fetch which of this class's co-teachers marked themselves
      // 'unavailable' for today via their own Calendar tab (see
      // data_import/27_teacher_availability.sql) -- renderAttendanceForm
      // uses this to default an un-recorded co-teacher's toggle to Absent
      // instead of Present, so a teacher who said in advance they
      // wouldn't be there stays marked absent even if whoever actually
      // takes attendance doesn't think to toggle it themselves. Skipped
      // entirely (rather than an `.in('teacher_id', [])` call, which some
      // Supabase clients treat as an error) when this class has no
      // co-teachers to look up.
      const coTeacherIds = (myClass.class_teachers || [])
        .map(ct => ct.teacher_id)
        .filter(id => id !== userId)
      const [{ data: existingStudentRecords }, { data: existingTeacherRecords }, { data: existingNote }, { data: availabilityRecords }] = await Promise.all([
        // marked_by is only needed for a grouped class (see below), to show
        // "submitted by <name>" per group -- harmless to always select it.
        supabase.from('attendance').select('id, student_id, status, needs_rework, marked_by').eq('class_id', myClass.id).eq('date', today),
        supabase.from('teacher_attendance').select('id, teacher_id, status, needs_rework').eq('class_id', myClass.id).eq('date', today),
        supabase.from('class_lesson_notes').select('note').eq('class_id', myClass.id).eq('date', today).maybeSingle(),
        coTeacherIds.length > 0
          ? supabase.from('teacher_availability').select('teacher_id, status').eq('session_date', today).in('teacher_id', coTeacherIds)
          : Promise.resolve({ data: [] })
      ])
      const unavailableTeacherIds = new Set(
        (availabilityRecords || []).filter(r => r.status === 'unavailable').map(r => r.teacher_id)
      )
      const attendanceData = {
        studentRecords: existingStudentRecords || [],
        teacherRecords: existingTeacherRecords || [],
        existingNote: existingNote || null,
        unavailableTeacherIds
      }
      // A class with at least one group defined by an admin (see
      // data_import/85_class_groups_generalized.sql's class_groups table
      // and admin.js's Class Groups tab) shows a group picker first
      // instead of jumping straight to one roster -- see
      // renderGroupPicker's own doc comment for why (any teacher can take
      // any group, on any day -- groups aren't owned by a specific
      // teacher). Gated on the class actually HAVING a group defined,
      // rather than on any student already being assigned to one, so a
      // freshly created group still shows the picker immediately (with
      // everyone in the "Ungrouped Students" card) rather than waiting
      // until someone's been assigned. Every other class has zero
      // class_groups rows and is completely unaffected: this takes the
      // exact same path it always has.
      const hasGroups = (myClass.class_groups || []).length > 0
      if (hasGroups) {
        renderGroupPicker(myClass, today, userId, attendanceData)
      } else {
        const hasRecords = attendanceData.studentRecords.length > 0
        const needsRework = hasRecords && attendanceData.studentRecords.some(r => r.needs_rework)
        renderAttendanceForm(myClass, today, userId, {
          ...attendanceData,
          hasRecords,
          needsRework,
          rosterStudents: myClass.students || []
        })
      }
      trackTeacherPresence(userId, myClass.id)
    } else if (activeTabName === 'logHours') {
      renderLogHoursTab(volunteerTeams, userId)
    } else if (activeTabName === 'history') {
      if (attendanceClasses.length === 0) return // see the 'attendance' branch above
      renderTeacherHistory(attendanceClasses[activeClassIndex])
    } else if (activeTabName === 'insights') {
      if (attendanceClasses.length === 0) return // see the 'attendance' branch above
      renderInsightsTab(attendanceClasses[activeClassIndex])
    } else if (activeTabName === 'kudos') {
      if (attendanceClasses.length === 0) return // see the 'attendance' branch above
      renderKudosTab(attendanceClasses[activeClassIndex], userId)
    } else if (activeTabName === 'smileBox') {
      renderSmileBoxTab(userId)
    } else {
      renderTeacherCalendar(userId)
    }
  }

  // Wire the drawer nav -- picking a tab updates activeTabName and
  // re-renders, same as the old flat tab row's click handler did.
  renderNavDrawer(document.getElementById('nav-container'), teacherTabs, activeTabName, (tabName) => {
    activeTabName = tabName
    renderActiveTab()
  })

  // Set up class switcher click handlers (no-op when there's only one
  // attendance class, since the switcher isn't rendered in that case)
  container.querySelectorAll('.class-switch-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.class-switch-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      activeClassIndex = Number(btn.dataset.index)
      renderActiveTab()
    })
  })

  // Show the default tab (see activeTabName above) for the first
  // attendance class by default
  renderActiveTab()
}

/**
 * Broadcasts, via Supabase Realtime Presence, that this teacher currently
 * has the attendance form open for `classId` right now. Read by the admin
 * dashboard's Today tab (see admin.js's renderTodayTab) to show a live dot
 * on a class card while its teacher is actually looking at it.
 *
 * Deliberately scoped to "right now, this one class" rather than "online
 * for this whole session": the only caller is renderActiveTab's
 * 'attendance' branch, called fresh right after the form itself renders,
 * and always preceded by cleanupTeacherPresenceChannel (see the top of
 * renderActiveTab) -- so switching to any other tab, switching class, or
 * navigating away from the teacher dashboard entirely (see main.js's
 * cleanupRealtimeChannels, called from renderDualRoleShell and sign-out)
 * all stop the broadcast immediately rather than leaving it running idle
 * in the background. Keeps the extra Realtime connection this adds no
 * broader than "a teacher is on their attendance screen right now" --
 * relevant given this app's Supabase project is on the free tier and
 * connection count has already come up this session.
 *
 * @param {string} userId
 * @param {string} classId
 */
function trackTeacherPresence(userId, classId) {
  window._teacherPresenceChannel = supabase.channel('teacher-presence')
  window._teacherPresenceChannel.subscribe(async (status) => {
    if (status !== 'SUBSCRIBED') return
    await window._teacherPresenceChannel.track({
      user_id: userId,
      class_id: classId,
      online_at: new Date().toISOString()
    })
  })
}

/**
 * Tears down the presence channel opened by trackTeacherPresence, if one
 * is open -- see that function's doc comment for when this runs from
 * within this file. main.js's cleanupRealtimeChannels reaches the same
 * window._teacherPresenceChannel directly (same pattern it already uses
 * for the Today tab's _attendanceChannel) rather than importing this, for
 * when a whole dashboard is unmounted rather than just a tab within it.
 */
function cleanupTeacherPresenceChannel() {
  if (window._teacherPresenceChannel) {
    supabase.removeChannel(window._teacherPresenceChannel)
    window._teacherPresenceChannel = null
  }
}

/**
 * Shown instead of the attendance form when today isn't open for
 * attendance -- either nothing is scheduled at all (`session` is null),
 * or it's scheduled but marked closed (a holiday, or a special event the
 * admin hasn't opened). See data_import/15_class_sessions.sql.
 *
 * @param {object} myClass
 * @param {string} today - 'YYYY-MM-DD'
 * @param {object|null} session - The class_sessions row for today, if any.
 */
function renderNoClassMessage(myClass, today, session) {
  const tabContent = document.getElementById('tab-content')
  const reason = session
    ? NO_CLASS_MESSAGES.closed(session.label)
    : NO_CLASS_MESSAGES.notScheduled
  tabContent.innerHTML = `
    <h3>${myClass.name} — ${today}</h3>
    <p class="no-class-message">${reason} ${NO_CLASS_MESSAGES.contactAdmin}</p>
  `
}

/**
 * Shown once today's attendance is settled -- either it was already
 * submitted before this render (see renderAttendanceForm's guard above),
 * or a submit/resubmit/self-edit save just succeeded (see the click
 * handler at the bottom of renderAttendanceForm). Shows exactly who was
 * marked present/absent (read-only -- see statusRows below), not just a
 * generic "submitted" message, so a teacher can actually check it's right
 * without having to remember what they clicked.
 *
 * Also renders an "Edit Attendance" button, which re-opens
 * renderAttendanceForm as editable -- updating the SAME rows in place
 * rather than inserting new ones, exactly like an admin-triggered rework
 * does (see data_import/56_teachers_self_edit_attendance.sql for the RLS
 * change this needed: teachers previously could only get back into an
 * editable form if an admin rejected their submission first). Fully
 * replaces the form (rather than just disabling the submit button and
 * leaving the Present/Absent toggles in place) once settled, so nothing
 * looks clickable when it isn't -- same reasoning as the read-only rows
 * below, just applied to the whole form.
 *
 * The lesson note is a separate, lower-stakes case that was already
 * self-editable before this (see renderLessonNoteDisplay below and
 * data_import/31_class_lesson_notes_editable.sql) -- unaffected by any of
 * this, still its own Edit/Add link.
 *
 * @param {object} myClass
 * @param {string} today - 'YYYY-MM-DD'
 * @param {string|null} [noteText] - Today's lesson note for this class, if
 *   one was written (see data_import/30_class_lesson_notes.sql) -- shown
 *   back as a chat-style bubble below the summary, with an Edit link.
 *   Omitted (or blank) shows "no note left" plus an "+ Add a note" link
 *   instead.
 * @param {string} userId - Signed-in teacher's id, recorded as `teacher_id`
 *   if editing the note here creates or updates its row, and as the actor
 *   on the audit_log entry that edit writes.
 * @param {object} existing
 * @param {Array<{student_id: string, status: string}>} existing.studentRecords
 *   Today's per-student status, for the read-only summary below. From a
 *   fresh DB fetch when this is the very first render of an
 *   already-submitted day (renderAttendanceForm's guard), or built fresh
 *   from the form's final DOM state right after a save (see
 *   renderAttendanceForm's submit handler) -- either way, always what was
 *   actually written, not stale.
 * @param {Array<{teacher_id: string, status: string}>} existing.teacherRecords
 *   Same idea, for co-teachers (the signed-in teacher's own row is always
 *   'present' and isn't shown as a toggle-able row here, same as the form
 *   itself).
 * @param {Set<string>} [existing.unavailableTeacherIds] - See
 *   renderAttendanceForm's own doc comment for this same field -- passed
 *   through unchanged so a co-teacher with no teacherRecords row (e.g.
 *   newly added to the roster since this day was submitted) shows the
 *   same Absent default here as they would on the editable form, rather
 *   than this read-only summary optimistically showing them Present.
 */
function renderAlreadySubmittedMessage(myClass, today, noteText, userId, existing) {
  const tabContent = document.getElementById('tab-content')
  const {
    studentRecords, teacherRecords, unavailableTeacherIds,
    // See renderAttendanceForm's own doc comment for these -- only set
    // when this view is for one group of a class with admin-defined groups
    // (see renderGroupPicker/openGroupAttendance and
    // data_import/85_class_groups_generalized.sql).
    rosterStudents, groupKey, groupLabel, otherGroupsStatus, onBackToGroups
  } = existing
  const unavailableIds = unavailableTeacherIds || new Set()

  const studentStatusById = new Map((studentRecords || []).map(r => [r.student_id, r.status]))
  const sortedStudents = [...(rosterStudents || myClass.students || [])]
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  const presentCount = sortedStudents.filter(s => (studentStatusById.get(s.id) || 'present') === 'present').length

  const buildStatusPill = (status) =>
    `<span class="status-badge status-badge-${status}">${status === 'absent' ? 'Absent' : 'Present'}</span>`

  const studentSummaryRows = sortedStudents
    .map((s, i) => `
      <div class="student-row-readonly">
        <span>${i + 1}. ${toTitleCase(s.full_name)}</span>
        ${buildStatusPill(studentStatusById.get(s.id) || 'present')}
      </div>
    `)
    .join('')

  // Same co-teacher set/order/exclusion as renderAttendanceForm's own
  // coTeachers, so the row order here matches what was actually toggled.
  const teacherStatusById = new Map((teacherRecords || []).map(r => [r.teacher_id, r.status]))
  const coTeachers = (myClass.class_teachers || [])
    .filter(ct => ct.teacher_id !== userId)
    .sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
  const coTeacherSummaryRows = coTeachers
    .map(ct => {
      const status = teacherStatusById.get(ct.teacher_id) || (unavailableIds.has(ct.teacher_id) ? 'absent' : 'present')
      return `
      <div class="student-row-readonly">
        <span>${toTitleCase(ct.profiles?.full_name) || 'Teacher'}</span>
        ${buildStatusPill(status)}
      </div>
    `
    })
    .join('')
  const coTeacherSummaryHtml = coTeachers.length > 0 ? `
    <h4>${TEACHER_MESSAGES.attendanceForm.coTeacherHeading}</h4>
    <div>${coTeacherSummaryRows}</div>
  ` : ''

  const groupContextHtml = groupKey ? `
    <div class="group-context-banner">
      <button type="button" id="back-to-groups-btn" class="back-to-groups-btn">${TEACHER_MESSAGES.attendanceForm.groupPicker.backToGroupsLabel}</button>
      <p class="group-context-label">${groupLabel}</p>
      ${(otherGroupsStatus || []).map(g => `<p class="group-context-other-status">${g.label}: ${g.statusText}</p>`).join('')}
    </div>
  ` : ''

  tabContent.innerHTML = `
    <h3>${myClass.name} — ${today}</h3>
    ${groupContextHtml}
    <p class="success">${TEACHER_MESSAGES.attendanceForm.alreadySubmitted}</p>
    ${sortedStudents.length > 0 ? `
      <h4>${TEACHER_MESSAGES.attendanceForm.submittedAttendanceHeading}</h4>
      <p class="attendance-summary">${TEACHER_MESSAGES.attendanceForm.presentCount(presentCount, sortedStudents.length)}</p>
      <div id="submitted-student-list">${studentSummaryRows}</div>
    ` : ''}
    ${coTeacherSummaryHtml}
    <div id="lesson-note-display"></div>
    <button type="button" id="edit-attendance-btn" class="edit-attendance-btn">${TEACHER_MESSAGES.attendanceForm.editAttendanceLabel}</button>
  `
  renderLessonNoteDisplay(myClass, today, noteText, userId)

  if (groupKey && onBackToGroups) {
    document.getElementById('back-to-groups-btn').addEventListener('click', onBackToGroups)
  }

  // Reopens the same form component used for a fresh submission or an
  // admin-triggered rework, just with isSelfEdit set instead of
  // needsRework -- see renderAttendanceForm for how those two differ (only
  // in notice text and audit-log wording; the actual save behavior, update
  // rows in place rather than insert, is identical for both). No re-fetch
  // needed: studentRecords/teacherRecords/noteText passed into this
  // function are exactly what the form needs to prefill itself. Group
  // context (if any) is passed straight through too, so editing a group's
  // attendance still shows that same group's "switch group"/other-status
  // banner rather than losing it.
  document.getElementById('edit-attendance-btn').addEventListener('click', () => {
    renderAttendanceForm(myClass, today, userId, {
      hasRecords: true,
      needsRework: false,
      isSelfEdit: true,
      studentRecords: studentRecords || [],
      teacherRecords: teacherRecords || [],
      existingNote: noteText ? { note: noteText } : null,
      unavailableTeacherIds: unavailableIds,
      rosterStudents, groupKey, groupLabel, otherGroupsStatus, onBackToGroups
    })
  })
}

/**
 * Renders the lesson-note bubble (or "no note left" line) plus an Edit/Add
 * link, into #lesson-note-display -- deliberately separate from the rest
 * of the locked attendance view above it, so editing a note never touches
 * or needs to re-render the attendance itself. Clicking the link swaps
 * this same container for a small textarea + Save/Cancel (see
 * renderLessonNoteEditForm), reusing the same word-counter behavior as the
 * main attendance form's note field.
 *
 * @param {object} myClass
 * @param {string} today - 'YYYY-MM-DD'
 * @param {string|null|undefined} noteText
 * @param {string} userId
 */
function renderLessonNoteDisplay(myClass, today, noteText, userId) {
  const container = document.getElementById('lesson-note-display')
  if (!container) return // tab may have been switched away from mid-edit
  const bubbleHtml = buildLessonNoteBubbleHtml(noteText) ||
    `<p class="lesson-note-bubble-empty">${TEACHER_MESSAGES.attendanceForm.lessonNoteEmpty}</p>`
  const linkLabel = noteText && noteText.trim()
    ? TEACHER_MESSAGES.attendanceForm.editNoteLabel
    : TEACHER_MESSAGES.attendanceForm.addNoteLabel
  container.innerHTML = `
    ${bubbleHtml}
    <button type="button" class="lesson-note-edit-btn">${linkLabel}</button>
  `
  container.querySelector('.lesson-note-edit-btn').addEventListener('click', () => {
    renderLessonNoteEditForm(container, myClass, today, noteText || '', userId)
  })
}

/**
 * Swaps #lesson-note-display for a small edit form: textarea (pre-filled),
 * live word counter, Save, and Cancel. Save upserts directly onto
 * class_lesson_notes keyed by (class_id, date) -- there's no need to know
 * whether a row already exists first, since the unique constraint from
 * data_import/30_class_lesson_notes.sql plus the update policy from
 * data_import/31_class_lesson_notes_editable.sql make this work whether
 * today's note already has a row or not. Cancel discards the edit and
 * restores the bubble exactly as it was.
 *
 * @param {HTMLElement} container - The #lesson-note-display element.
 * @param {object} myClass
 * @param {string} today - 'YYYY-MM-DD'
 * @param {string} currentText - The note's current saved text (possibly
 *   empty), used to pre-fill the textarea and to restore the bubble on Cancel.
 * @param {string} userId
 */
function renderLessonNoteEditForm(container, myClass, today, currentText, userId) {
  container.innerHTML = `
    <div class="lesson-note-section">
      <textarea id="lesson-note-edit-textarea" class="lesson-note-textarea" placeholder="${TEACHER_MESSAGES.attendanceForm.lessonNotePlaceholder}">${escapeHtml(currentText)}</textarea>
      <p id="lesson-note-edit-counter" class="lesson-note-counter"></p>
      <div class="lesson-note-edit-actions">
        <button type="button" class="lesson-note-save-btn">${TEACHER_MESSAGES.attendanceForm.saveNoteLabel}</button>
        <button type="button" class="lesson-note-cancel-btn">${TEACHER_MESSAGES.attendanceForm.cancelNoteLabel}</button>
      </div>
      <p id="lesson-note-edit-message" class="hidden"></p>
    </div>
  `

  const textarea = document.getElementById('lesson-note-edit-textarea')
  const counterEl = document.getElementById('lesson-note-edit-counter')
  const saveBtn = container.querySelector('.lesson-note-save-btn')
  const countWords = (text) => {
    const trimmed = text.trim()
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
  }
  const updateCounter = () => {
    const words = countWords(textarea.value)
    const overLimit = words > LESSON_NOTE_MAX_WORDS
    counterEl.textContent = overLimit
      ? TEACHER_MESSAGES.attendanceForm.lessonNoteOverLimit(LESSON_NOTE_MAX_WORDS)
      : TEACHER_MESSAGES.attendanceForm.lessonNoteCounter(words, LESSON_NOTE_MAX_WORDS)
    counterEl.classList.toggle('over-limit', overLimit)
    counterEl.classList.toggle('warning', !overLimit && words > LESSON_NOTE_MAX_WORDS * 0.9)
    saveBtn.disabled = overLimit
  }
  textarea.addEventListener('input', updateCounter)
  updateCounter()
  textarea.focus()

  container.querySelector('.lesson-note-cancel-btn').addEventListener('click', () => {
    renderLessonNoteDisplay(myClass, today, currentText, userId)
  })

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true
    const newText = textarea.value.trim()
    const { error } = await supabase.from('class_lesson_notes').upsert(
      { class_id: myClass.id, date: today, note: newText || null, teacher_id: userId },
      { onConflict: 'class_id,date' }
    )
    if (error) {
      const msg = document.getElementById('lesson-note-edit-message')
      msg.textContent = TEACHER_MESSAGES.attendanceForm.couldntSaveNote(error.message)
      msg.className = 'error'
      msg.classList.remove('hidden')
      saveBtn.disabled = false
      return
    }
    logAudit(
      userId, 'teacher', 'attendance.lesson_note_edited', 'attendance', myClass.id,
      `Edited ${myClass.name} lesson note for ${today}`,
      { class_id: myClass.id, date: today, word_count: countWords(newText) }
    )
    showToast(TEACHER_MESSAGES.attendanceForm.noteSaved)
    renderLessonNoteDisplay(myClass, today, newText, userId)
  })
}

/**
 * Builds the "sent chat message" bubble HTML for a lesson note -- shared by
 * the teacher's own locked view (renderAlreadySubmittedMessage) and used
 * the same way from admin.js's review modal, so the note reads identically
 * wherever it's shown. Returns an empty string (no bubble at all) when
 * there's no note to show, rather than an empty bubble.
 *
 * @param {string|null|undefined} noteText
 * @returns {string} HTML, or '' if `noteText` is blank.
 */
export function buildLessonNoteBubbleHtml(noteText) {
  if (!noteText || !noteText.trim()) return ''
  // Escaped first, then newlines turned into <br> -- doing it in that order
  // means a literal "<br>" a teacher actually typed can't sneak an extra
  // line break in as real markup (see format.js's escapeHtml).
  const safeHtml = escapeHtml(noteText.trim()).replace(/\n/g, '<br>')
  return `
    <div class="lesson-note-bubble-wrap">
      <div class="lesson-note-bubble">${safeHtml}</div>
    </div>
  `
}

/**
 * Partitions a class's roster into its real, admin-defined groups (see
 * data_import/85_class_groups_generalized.sql's class_groups table and
 * admin.js's Class Groups tab), plus a trailing pseudo-group for anyone not
 * yet assigned to one. Shared by renderGroupPicker, openGroupAttendance,
 * and renderAttendanceForm's post-save refresh, so all three always agree
 * on exactly the same split without re-deriving it differently in three
 * places.
 *
 * Every real group is always included, even with zero students right now
 * -- these are deliberate admin data (see admin.js's renderClassGroupsTab),
 * not derived from who happens to be assigned, so a freshly created empty
 * group still shows up rather than silently waiting for its first student.
 * The "ungrouped" pseudo-group is the one exception -- it only appears
 * when there's actually at least one student in it, since it's not a real
 * group, just "not assigned to a real one yet".
 *
 * @param {Array} students
 * @param {Array<{id: string, name: string}>} classGroups - This class's
 *   own class_groups rows (myClass.class_groups).
 * @returns {Array<{key: string, label: string, students: Array}>} `key` is
 *   a real group's id, or the literal string 'ungrouped' for the
 *   pseudo-group.
 */
function getGroupPartitions(students, classGroups) {
  const namedGroups = (classGroups || []).map(g => ({
    key: g.id,
    label: g.name,
    students: students.filter(s => s.class_group_id === g.id)
  }))
  const ungroupedStudents = students.filter(s => !s.class_group_id)
  return ungroupedStudents.length > 0
    ? [...namedGroups, { key: 'ungrouped', label: TEACHER_MESSAGES.attendanceForm.groupPicker.ungroupedLabel, students: ungroupedStudents }]
    : namedGroups
}

/**
 * Teacher id -> display name, for resolving an attendance row's marked_by
 * into "submitted by <name>" wherever a group's status is shown. Built
 * from this class's own co-teacher list (myClass.class_teachers, which
 * already carries profiles.full_name from renderTeacherDashboard's initial
 * query) rather than a fresh query -- every marked_by on this class's rows
 * is necessarily one of its own assigned teachers (including an admin who
 * submitted on a teacher's behalf, since admins are linked via
 * class_teachers too -- see data_import/06_multi_teacher_classes.sql).
 *
 * @param {object} myClass
 * @returns {Map<string, string|null>}
 */
function buildNameByTeacherId(myClass) {
  return new Map((myClass.class_teachers || []).map(ct => [ct.teacher_id, toTitleCase(ct.profiles?.full_name) || null]))
}

/**
 * Builds one group's read-only status -- not yet submitted, submitted (by
 * whoever's marked_by resolves to), or sent back for rework -- from the
 * class+date attendance rows already fetched for the WHOLE class, filtered
 * down to just this group's student ids rather than re-querying per group.
 * Shared by renderGroupPicker's cards, openGroupAttendance's "other group"
 * banner, and renderAttendanceForm's post-save refresh of that same
 * banner, so the wording and logic are identical everywhere a group's
 * status shows up.
 *
 * @param {{key: string, label: string, students: Array}} groupDef
 * @param {Array} studentRecords - This class+date's attendance rows
 *   (unfiltered across the whole roster) -- `{student_id, status,
 *   needs_rework, marked_by}`.
 * @param {Map<string, string|null>} nameByTeacherId
 * @returns {{key: string, label: string, statusText: string, hasRecords: boolean, needsRework: boolean}}
 */
function buildGroupStatus(groupDef, studentRecords, nameByTeacherId) {
  const ids = new Set(groupDef.students.map(s => s.id))
  const records = (studentRecords || []).filter(r => ids.has(r.student_id))
  const hasRecords = records.length > 0
  const needsRework = hasRecords && records.some(r => r.needs_rework)
  const statusText = needsRework
    ? TEACHER_MESSAGES.attendanceForm.groupPicker.statusNeedsRework
    : hasRecords
      ? TEACHER_MESSAGES.attendanceForm.groupPicker.statusSubmitted(nameByTeacherId.get(records[0].marked_by) || null)
      : TEACHER_MESSAGES.attendanceForm.groupPicker.statusNotSubmitted
  return {
    key: groupDef.key,
    label: groupDef.label,
    statusText,
    hasRecords,
    needsRework
  }
}

/**
 * Shown instead of jumping straight to a single roster, for a class that
 * has at least one admin-defined group (see
 * data_import/85_class_groups_generalized.sql's class_groups table and
 * admin.js's Class Groups tab). Any teacher assigned to the class can take
 * attendance for any group on a given day -- groups aren't tied to a
 * specific teacher, they're just a roster split an admin created -- so
 * this always asks which one instead of assuming a fixed teacher-to-group
 * mapping. Each group's submission status is shown right on its card,
 * read-only, so whoever's here can see at a glance whether the whole class
 * is covered without needing to open another group's screen.
 *
 * A student who hasn't been assigned to any real group yet
 * (students.class_group_id is null) is NOT hidden and NOT silently
 * skipped: they get their own "Ungrouped Students" card, with completely
 * normal attendance toggles once opened -- just visually flagged as
 * needing a real group assignment from the admin's Class Groups tab. Every
 * real group plus this pseudo-group (via getGroupPartitions) is always a
 * strict partition of the roster -- every student is in exactly one -- so
 * there's no possibility of the same student's attendance being submitted
 * twice from two different cards.
 *
 * @param {object} myClass
 * @param {string} today - 'YYYY-MM-DD'
 * @param {string} userId
 * @param {object} existing - Same studentRecords/teacherRecords/
 *   existingNote/unavailableTeacherIds fetched once for the whole
 *   class+date in renderActiveTab -- this function only partitions
 *   studentRecords per group, it never re-fetches.
 */
function renderGroupPicker(myClass, today, userId, existing) {
  const tabContent = document.getElementById('tab-content')
  const { studentRecords } = existing

  const groupDefs = getGroupPartitions(myClass.students || [], myClass.class_groups || [])
  const nameByTeacherId = buildNameByTeacherId(myClass)

  const cardsHtml = groupDefs
    .map(g => {
      const status = buildGroupStatus(g, studentRecords, nameByTeacherId)
      const cardStateClass = status.needsRework ? 'needs-rework' : status.hasRecords ? 'submitted' : 'waiting'
      return `
      <div class="status-card ${cardStateClass}">
        <strong>${status.label}</strong>
        <p class="group-picker-count">${TEACHER_MESSAGES.attendanceForm.groupPicker.studentCount(g.students.length)}</p>
        ${g.key === 'ungrouped' ? `<p class="group-picker-ungrouped-hint">${TEACHER_MESSAGES.attendanceForm.groupPicker.ungroupedCardHint(g.students.length)}</p>` : ''}
        <span class="status-badge">${status.statusText}</span>
        <button type="button" class="group-picker-open-btn" data-group-key="${g.key}">${TEACHER_MESSAGES.attendanceForm.groupPicker.openButtonLabel}</button>
      </div>
    `
    })
    .join('')

  tabContent.innerHTML = `
    <h3>${myClass.name} — ${today}</h3>
    <p class="drag-hint">${TEACHER_MESSAGES.attendanceForm.groupPicker.hint}</p>
    <div class="status-grid group-picker-list">${cardsHtml}</div>
  `

  tabContent.querySelectorAll('.group-picker-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const group = groupDefs.find(g => g.key === btn.dataset.groupKey)
      openGroupAttendance(myClass, today, userId, existing, group)
    })
  })
}

/**
 * Shared by every "open this group's attendance" click from
 * renderGroupPicker: computes this specific group's hasRecords/needsRework
 * from the full class+date studentRecords already fetched (no re-fetch),
 * builds the other group(s)' read-only status for the cross-group
 * context banner, and hands off to the normal renderAttendanceForm exactly
 * as a non-grouped class would use it -- grouping only ever changes WHICH
 * roster/records that form sees, never how it works once a group is
 * picked.
 *
 * @param {object} myClass
 * @param {string} today
 * @param {string} userId
 * @param {object} existing - Full class+date existing data, as passed into
 *   renderGroupPicker.
 * @param {{key: string, label: string, students: Array}} group - The group being opened.
 */
function openGroupAttendance(myClass, today, userId, existing, group) {
  const { studentRecords } = existing
  const groupIds = new Set(group.students.map(s => s.id))
  const groupRecords = (studentRecords || []).filter(r => groupIds.has(r.student_id))
  const hasRecords = groupRecords.length > 0
  const needsRework = hasRecords && groupRecords.some(r => r.needs_rework)

  const nameByTeacherId = buildNameByTeacherId(myClass)
  const otherGroupsStatus = getGroupPartitions(myClass.students || [], myClass.class_groups || [])
    .filter(g => g.key !== group.key)
    .map(g => buildGroupStatus(g, studentRecords, nameByTeacherId))

  renderAttendanceForm(myClass, today, userId, {
    ...existing,
    hasRecords,
    needsRework,
    studentRecords: groupRecords,
    rosterStudents: group.students,
    groupKey: group.key,
    groupLabel: group.label,
    otherGroupsStatus,
    onBackToGroups: () => renderGroupPicker(myClass, today, userId, existing)
  })
}

/**
 * Render the "Take Attendance" tab: a Present/Absent toggle per student,
 * a Present/Absent toggle per co-teacher (if any), and a submit button
 * that batch-inserts today's student attendance AND teacher attendance
 * records (see data_import/18_teacher_attendance.sql). The teacher who's
 * actually signed in and hits Submit is recorded as present automatically
 * -- no toggle for their own row, since submitting the form is itself
 * proof they were there.
 *
 * If attendance was already submitted today and nothing's flagged, shows a
 * read-only message instead so the same class can't be marked twice in one
 * day. If an admin has flagged it for rework instead (see
 * data_import/22_attendance_rework_flag.sql), OR the teacher themselves
 * clicked "Edit Attendance" on that read-only view (existing.isSelfEdit --
 * see renderAlreadySubmittedMessage and
 * data_import/56_teachers_self_edit_attendance.sql), the form reopens
 * pre-filled with exactly what was submitted -- every toggle defaults to
 * its existing status rather than resetting to Present -- so only whatever
 * was actually wrong needs to change before saving again; that updates the
 * existing rows in place (and, for the rework case, clears the flag) for
 * anyone who already had one, and inserts a fresh row for anyone who
 * didn't -- a student or co-teacher who's newly on the roster since the
 * original submission (e.g. a class/optional-class reassignment made
 * after that day was already submitted -- see
 * data_import/64_assign_gita_optional_class.sql for a real example) has no
 * existing row to update, so would otherwise get silently skipped despite
 * the form showing a toggle for them and the save reporting success.
 * needsRework and isSelfEdit both take this same path and are otherwise
 * handled identically below
 * except for notice text and audit-log wording -- kept as two separate
 * flags rather than one, purely so the on-screen notice can correctly say
 * *why* the form reopened (an admin rejected it vs. the teacher chose to
 * fix it themselves).
 *
 * @param {object} myClass - The teacher's class row, including `.students`
 *   and `.class_teachers` (each with `.teacher_id` and `.profiles.full_name`).
 * @param {string} today - 'YYYY-MM-DD' for the current date.
 * @param {string} userId - Supabase auth user id of the signed-in teacher --
 *   recorded as `marked_by` on every row a fresh submission creates, and
 *   automatically as `present` for their own teacher_attendance row.
 * @param {object} existing
 * @param {boolean} existing.hasRecords - Whether today's attendance rows
 *   for this class already exist (fresh, flagged, or self-edit either way).
 * @param {boolean} existing.needsRework - Whether an admin flagged them for rework.
 * @param {boolean} [existing.isSelfEdit] - Whether the teacher themselves
 *   requested to edit an already-submitted (not otherwise flagged) day.
 * @param {Array} existing.studentRecords - Today's `attendance` rows for
 *   this class, if any -- `{id, student_id, status, needs_rework}`.
 * @param {Array} existing.teacherRecords - Today's `teacher_attendance`
 *   rows for this class, if any -- `{id, teacher_id, status, needs_rework}`.
 * @param {Set<string>} [existing.unavailableTeacherIds] - Co-teacher ids who
 *   marked themselves 'unavailable' for today via the Calendar tab's
 *   Unavailable toggle (see data_import/27_teacher_availability.sql and
 *   renderTeacherCalendar below). Only consulted for a co-teacher row that
 *   has no existing teacher_attendance record yet -- an explicit prior
 *   submission always wins. Without this, a co-teacher who told the app in
 *   advance they wouldn't be there still defaulted to "Present" on the
 *   toggle, so if whoever actually took attendance didn't notice and
 *   correct it, the saved record wrongly showed them present. Defaults to
 *   an empty set when omitted, for safety.
 */
function renderAttendanceForm(myClass, today, userId, existing) {
  const tabContent = document.getElementById('tab-content')
  const {
    hasRecords, needsRework, isSelfEdit, studentRecords, teacherRecords, existingNote, unavailableTeacherIds,
    // Only set when this form was opened from renderGroupPicker/
    // openGroupAttendance (a class with at least one admin-defined group --
    // see that function's own doc comment). rosterStudents is which
    // students to actually show; falls back to the whole class below when
    // this class isn't grouped at all, so every existing (non-grouped)
    // call site is unaffected.
    rosterStudents, groupKey, groupLabel, otherGroupsStatus, onBackToGroups
  } = existing
  const unavailableIds = unavailableTeacherIds || new Set()

  // Block duplicate submissions for the same day -- but only when nothing's
  // flagged and the teacher hasn't asked to edit it themselves either. A
  // flagged (or self-edit-requested) submission falls through to the form
  // below instead, pre-filled rather than blank.
  if (hasRecords && !needsRework && !isSelfEdit) {
    renderAlreadySubmittedMessage(myClass, today, existingNote?.note, userId, {
      studentRecords, teacherRecords, unavailableTeacherIds: unavailableIds,
      rosterStudents, groupKey, groupLabel, otherGroupsStatus, onBackToGroups
    })
    return
  }

  // Previously-submitted status per student/co-teacher, keyed for lookup
  // while building each row below. Empty on a fresh (never-submitted) form,
  // so every row just falls back to its default of Present as before.
  const studentStatusById = new Map(studentRecords.map(r => [r.student_id, r.status]))
  const teacherStatusById = new Map(teacherRecords.map(r => [r.teacher_id, r.status]))

  // Build a toggle row for each student (alphabetical -- an optional
  // class's roster spans multiple grades, so name order is more useful
  // than whatever order the query happens to return), defaulting to
  // "Present" unless reworking an existing submission, in which case it
  // defaults to whatever was actually submitted.
  const sortedStudents = [...(rosterStudents || myClass.students || [])]
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  const studentRows = sortedStudents
    .map((s, i) => {
      const status = studentStatusById.get(s.id) || 'present'
      return `
      <div class="student-row" data-student-id="${s.id}">
        <span>${i + 1}. ${toTitleCase(s.full_name)}</span>
        <div class="status-toggle">
          <button class="toggle-btn present-btn${status === 'present' ? ' active' : ''}" data-status="present">Present</button>
          <button class="toggle-btn absent-btn${status === 'absent' ? ' active' : ''}" data-status="absent">Absent</button>
        </div>
      </div>
    `
    })
    .join('')

  // Co-teacher(s) assigned to this same class, excluding the signed-in
  // teacher themselves -- their own attendance is recorded automatically
  // below, not through a toggle. Only rendered when there's at least one.
  const coTeachers = (myClass.class_teachers || [])
    .filter(ct => ct.teacher_id !== userId)
    .sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
  const coTeacherRows = coTeachers
    .map(ct => {
      // An explicit prior submission always wins; failing that, a
      // co-teacher who marked themselves unavailable for today (see
      // unavailableTeacherIds above) defaults to Absent instead of the
      // usual Present, so it stays correct even if whoever's actually
      // taking attendance doesn't think to toggle it themselves.
      const status = teacherStatusById.get(ct.teacher_id) || (unavailableIds.has(ct.teacher_id) ? 'absent' : 'present')
      return `
      <div class="co-teacher-row" data-teacher-id="${ct.teacher_id}">
        <span>${toTitleCase(ct.profiles?.full_name) || 'Teacher'}</span>
        <div class="status-toggle">
          <button class="toggle-btn present-btn${status === 'present' ? ' active' : ''}" data-status="present">Present</button>
          <button class="toggle-btn absent-btn${status === 'absent' ? ' active' : ''}" data-status="absent">Absent</button>
        </div>
      </div>
    `
    })
    .join('')
  const coTeacherSectionHtml = coTeachers.length > 0 ? `
    <h4>${TEACHER_MESSAGES.attendanceForm.coTeacherHeading}</h4>
    <div id="co-teacher-list">${coTeacherRows}</div>
  ` : ''

  // Only one of these ever applies at once (needsRework and isSelfEdit are
  // mutually exclusive in practice -- see renderAlreadySubmittedMessage,
  // the only place isSelfEdit is ever set to true, which only happens from
  // the non-flagged branch of its own caller's guard above), but written as
  // two independent checks rather than an if/else chain so a future case
  // that's neither still falls through to the plain (fresh submission)
  // wording without needing to touch this.
  // Shown only when this form was opened from the group picker (see
  // openGroupAttendance above) -- a "switch group" link back to the
  // picker, plus a read-only line for every OTHER group's current status,
  // so whoever's filling this in can tell at a glance whether the rest of
  // the class still needs doing without leaving this screen. Absent
  // entirely for a non-grouped class, same as before this feature existed.
  const groupContextHtml = groupKey ? `
    <div class="group-context-banner">
      <button type="button" id="back-to-groups-btn" class="back-to-groups-btn">${TEACHER_MESSAGES.attendanceForm.groupPicker.backToGroupsLabel}</button>
      <p class="group-context-label">${groupLabel}</p>
      ${(otherGroupsStatus || []).map(g => `<p class="group-context-other-status">${g.label}: ${g.statusText}</p>`).join('')}
    </div>
  ` : ''

  const reworkNoticeHtml = needsRework ? `<p class="rework-notice">${TEACHER_MESSAGES.attendanceForm.reworkNotice}</p>` : ''
  const selfEditNoticeHtml = isSelfEdit ? `<p class="self-edit-notice">${TEACHER_MESSAGES.attendanceForm.selfEditNotice}</p>` : ''
  const submitLabel = needsRework
    ? TEACHER_MESSAGES.attendanceForm.resubmitLabel
    : isSelfEdit
      ? TEACHER_MESSAGES.attendanceForm.saveChangesLabel
      : TEACHER_MESSAGES.attendanceForm.submitLabel

  // Live "X of Y present" count -- see updateAttendanceSummary below for
  // where it's kept in sync with every toggle click. Only rendered when
  // there's actually a student roster to count (mirrors hasAnyoneToMark's
  // own students-only half below); a co-teacher-only edge case has nothing
  // for this to count.
  const attendanceSummaryHtml = sortedStudents.length > 0
    ? `<p id="attendance-summary" class="attendance-summary"></p>`
    : ''

  // Nothing to mark at all (no students, no co-teachers) -- the button
  // stays disabled rather than letting a click submit an empty class.
  // This is also what used to let a volunteer team (which has no real
  // roster) slip a "submit" through and crash on teacher_attendance's
  // unique constraint the second time it happened -- see this file's
  // renderTeacherDashboard doc comment; that's fixed structurally now (a
  // volunteer team never reaches this form at all), but this stays as a
  // second line of defense for any genuinely empty attendance class too.
  const hasAnyoneToMark = sortedStudents.length > 0 || coTeachers.length > 0

  // "What did you teach today" -- optional, shares this same Submit /
  // Resubmit button rather than having a save step of its own (see
  // data_import/30_class_lesson_notes.sql). Pre-filled with whatever was
  // already written when reworking; blank on a fresh submission.
  const existingNoteText = existingNote?.note || ''
  const lessonNoteSectionHtml = `
    <div class="lesson-note-section">
      <label for="lesson-note-textarea">${TEACHER_MESSAGES.attendanceForm.lessonNoteLabel}</label>
      <textarea id="lesson-note-textarea" class="lesson-note-textarea" placeholder="${TEACHER_MESSAGES.attendanceForm.lessonNotePlaceholder}">${escapeHtml(existingNoteText)}</textarea>
      <p id="lesson-note-counter" class="lesson-note-counter"></p>
    </div>
  `

  // Render the form layout
  tabContent.innerHTML = `
    <h3>${myClass.name} — ${today}</h3>
    ${groupContextHtml}
    ${reworkNoticeHtml}
    ${selfEditNoticeHtml}
    <div id="student-list">${studentRows || `<p>${TEACHER_MESSAGES.attendanceForm.noStudentsInClass}</p>`}</div>
    ${attendanceSummaryHtml}
    ${coTeacherSectionHtml}
    ${lessonNoteSectionHtml}
    <button id="submit-attendance"${hasAnyoneToMark ? '' : ' disabled'}>${submitLabel}</button>
    <p id="submit-message" class="hidden"></p>
  `

  if (groupKey && onBackToGroups) {
    document.getElementById('back-to-groups-btn').addEventListener('click', onBackToGroups)
  }

  // Recomputes the "X of Y present" line from whatever's actually toggled
  // active in #student-list right now -- scoped to that container
  // specifically (not .toggle-btn generally) so co-teacher toggles, which
  // live in a separate #co-teacher-list, never get counted as "kids".
  // Called once below to reflect the form's starting state, then again on
  // every student toggle click.
  const summaryEl = document.getElementById('attendance-summary')
  const updateAttendanceSummary = () => {
    if (!summaryEl) return
    const presentCount = document.querySelectorAll('#student-list .present-btn.active').length
    // innerHTML, not textContent -- presentCount's message now wraps the
    // numbers in <strong> (see config.js) so they stand out visually; both
    // are plain integers computed right above, never anything that needs
    // escaping.
    summaryEl.innerHTML = TEACHER_MESSAGES.attendanceForm.presentCount(presentCount, sortedStudents.length)
  }
  updateAttendanceSummary()

  // Make toggle buttons switch between Present and Absent within each row
  // (shared by both student rows and co-teacher rows)
  tabContent.querySelectorAll('.student-row, .co-teacher-row').forEach(row => {
    row.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        updateAttendanceSummary()
      })
    })
  })

  // Live word counter for the lesson note -- past LESSON_NOTE_MAX_WORDS the
  // count turns red and the submit button disables, same "can't submit
  // until this is fixed" treatment as hasAnyoneToMark below. Re-checked on
  // every keystroke rather than only at submit time, so the teacher sees
  // the limit coming rather than hitting Submit and being told no.
  const noteTextarea = document.getElementById('lesson-note-textarea')
  const noteCounterEl = document.getElementById('lesson-note-counter')
  const submitBtn = document.getElementById('submit-attendance')
  const countWords = (text) => {
    const trimmed = text.trim()
    return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length
  }
  const updateNoteCounter = () => {
    const words = countWords(noteTextarea.value)
    const overLimit = words > LESSON_NOTE_MAX_WORDS
    noteCounterEl.textContent = overLimit
      ? TEACHER_MESSAGES.attendanceForm.lessonNoteOverLimit(LESSON_NOTE_MAX_WORDS)
      : TEACHER_MESSAGES.attendanceForm.lessonNoteCounter(words, LESSON_NOTE_MAX_WORDS)
    noteCounterEl.classList.toggle('over-limit', overLimit)
    noteCounterEl.classList.toggle('warning', !overLimit && words > LESSON_NOTE_MAX_WORDS * 0.9)
    submitBtn.disabled = !hasAnyoneToMark || overLimit
  }
  noteTextarea.addEventListener('input', updateNoteCounter)
  updateNoteCounter() // initialize for the pre-filled rework case too

  // Submit (or, when reworking, resubmit) on click. Disabled synchronously
  // for the whole request, not just after it settles -- a fast double
  // click (or a slow network turning one click into what feels like two)
  // used to be able to fire this twice, and a second identical insert
  // fails on teacher_attendance's (class_id, teacher_id, date) unique
  // constraint. Re-enabled on error so a genuine failure can be retried.
  document.getElementById('submit-attendance').addEventListener('click', async () => {
    submitBtn.disabled = true
    const noteText = noteTextarea.value.trim()

    // Counted once up front (not branch-specific) for the audit summary
    // below -- the DOM's current toggle state is the same regardless of
    // whether this ends up as an insert or an update.
    const presentCount = [...tabContent.querySelectorAll('.student-row, .co-teacher-row')]
      .filter(row => (row.querySelector('.toggle-btn.active')?.dataset.status || 'present') === 'present').length + 1 // +1 for the signed-in teacher's own always-present row
    const absentCount = [...tabContent.querySelectorAll('.student-row, .co-teacher-row')]
      .filter(row => row.querySelector('.toggle-btn.active')?.dataset.status === 'absent').length

    // The lesson note is upserted by (class_id, date) either way -- fresh
    // submission or rework resubmit -- rather than branching on whether a
    // row already exists: the unique constraint from
    // data_import/30_class_lesson_notes.sql plus the update policy from
    // data_import/31_class_lesson_notes_editable.sql make a plain upsert
    // work in both cases, so there's no need to track the note's row id
    // through this function at all. Written even when left blank
    // (note: null), so this table's (class_id, date) always lines up 1:1
    // with a submitted day, same as attendance/teacher_attendance.
    const noteWrite = supabase.from('class_lesson_notes').upsert(
      { class_id: myClass.id, date: today, note: noteText || null, teacher_id: userId, needs_rework: false },
      { onConflict: 'class_id,date' }
    )

    // STUDENT writes: an admin-triggered rework and a teacher-initiated
    // self-edit (see renderAlreadySubmittedMessage's "Edit Attendance"
    // button and data_import/56_teachers_self_edit_attendance.sql) update
    // the existing rows in place rather than inserting new ones -- the row
    // IS the original submission, just corrected, either way. A fresh
    // submission for THIS roster (this group, or the whole class on a
    // non-grouped class) batch-inserts instead. Scoped to whatever's
    // actually in #student-list, which is already just this form's
    // rosterStudents (see sortedStudents above) -- a grouped class's OTHER
    // group is never touched by this, whichever branch runs.
    const isEditingExisting = needsRework || isSelfEdit
    let studentWrites
    if (isEditingExisting) {
      const studentRecordIdByStudentId = new Map(studentRecords.map(r => [r.student_id, r.id]))
      // A student with no existing row for this date -- newly on the
      // roster since the original submission, rather than someone whose
      // status is being corrected -- has no id to update. `.eq('id',
      // undefined)` doesn't error, it just matches zero rows, so this
      // used to silently do nothing for them while still reporting
      // success. Insert a fresh row instead whenever there's no existing
      // one to update.
      studentWrites = [...tabContent.querySelectorAll('.student-row')].map(row => {
        const activeBtn = row.querySelector('.toggle-btn.active')
        const status = activeBtn ? activeBtn.dataset.status : 'present'
        const studentId = row.dataset.studentId
        const recordId = studentRecordIdByStudentId.get(studentId)
        return recordId
          ? supabase.from('attendance').update({ status, needs_rework: false }).eq('id', recordId)
          : supabase.from('attendance').insert({ student_id: studentId, class_id: myClass.id, date: today, status, marked_by: userId })
      })
    } else {
      const records = [...tabContent.querySelectorAll('.student-row')].map(row => {
        const activeBtn = row.querySelector('.toggle-btn.active')
        const status = activeBtn ? activeBtn.dataset.status : 'present'
        return { student_id: row.dataset.studentId, class_id: myClass.id, date: today, status, marked_by: userId }
      })
      studentWrites = [supabase.from('attendance').insert(records)]
    }

    // TEACHER writes: ALWAYS update-in-place when a row already exists,
    // insert only when it doesn't -- regardless of isEditingExisting.
    // teacher_attendance is keyed by (class_id, teacher_id, date), never by
    // student group, so on a grouped class a co-teacher's row for today
    // may already exist from whoever submitted the OTHER group earlier
    // (or from this same teacher having already submitted once and coming
    // back to do the other group too) -- looked up here from
    // teacherRecords, which renderActiveTab always fetches for the whole
    // class+date, never scoped to one roster. On a non-grouped class
    // teacherRecords is always empty on a genuinely first submission
    // anyway, so this collapses to exactly the same inserts as before --
    // this is a behavior-preserving generalization of the old
    // isEditingExisting-only teacher-update logic, not a special case
    // added just for grouped classes. Without this, the second group to
    // submit on a given day would hit teacher_attendance's (class_id,
    // teacher_id, date) unique constraint trying to insert a row that
    // already exists.
    const teacherRecordIdByTeacherId = new Map(teacherRecords.map(r => [r.teacher_id, r.id]))
    const teacherWrites = []
    const ownRecordId = teacherRecordIdByTeacherId.get(userId)
    teacherWrites.push(
      ownRecordId
        ? supabase.from('teacher_attendance').update({ status: 'present', needs_rework: false }).eq('id', ownRecordId)
        : supabase.from('teacher_attendance').insert({ class_id: myClass.id, teacher_id: userId, date: today, status: 'present', marked_by: userId })
    )
    tabContent.querySelectorAll('.co-teacher-row').forEach(row => {
      const activeBtn = row.querySelector('.toggle-btn.active')
      const status = activeBtn ? activeBtn.dataset.status : 'present'
      const teacherId = row.dataset.teacherId
      const recordId = teacherRecordIdByTeacherId.get(teacherId)
      teacherWrites.push(
        recordId
          ? supabase.from('teacher_attendance').update({ status, needs_rework: false }).eq('id', recordId)
          : supabase.from('teacher_attendance').insert({ class_id: myClass.id, teacher_id: teacherId, date: today, status, marked_by: userId })
      )
    })

    // All writes are independent tables -- run them together rather than
    // one-then-the-other, so a slow network doesn't make this feel like
    // several separate submits.
    const writes = Promise.all([...studentWrites, ...teacherWrites, noteWrite])

    const results = await writes
    const firstError = results.find(r => r.error)?.error
    const msg = document.getElementById('submit-message')

    if (firstError) {
      msg.textContent = TEACHER_MESSAGES.attendanceForm.submitError(firstError.message)
      msg.className = 'error'
      // Let them retry -- see the click handler's doc comment above for
      // why this was disabled in the first place.
      submitBtn.disabled = false
    } else {
      const auditAction = needsRework ? 'attendance.resubmitted' : isSelfEdit ? 'attendance.self_edited' : 'attendance.submitted'
      const auditVerb = needsRework ? 'Resubmitted' : isSelfEdit ? 'Edited' : 'Submitted'
      logAudit(
        userId, 'teacher', auditAction,
        'attendance', myClass.id,
        `${auditVerb} ${myClass.name} attendance for ${today} (${presentCount} present, ${absentCount} absent)`,
        { class_id: myClass.id, date: today, present_count: presentCount, absent_count: absentCount, lesson_note_word_count: countWords(noteText) }
      )
      // Toast gives the one-time "you just did that" confirmation (worded
      // differently for each of the three cases); the screen itself
      // replaces the whole form with the locked read-only view (see
      // renderAlreadySubmittedMessage) rather than just disabling the
      // submit button in place -- otherwise every Present/Absent toggle
      // stayed clickable with nothing left for a click to do, which looked
      // like the screen could still be changed when it couldn't. Today's
      // records are settled again now; getting back into an editable form
      // from here means either an admin rejecting it for rework, or
      // clicking that view's own "Edit Attendance" button.
      showToast(
        needsRework ? TEACHER_MESSAGES.attendanceForm.reworkSubmitted
          : isSelfEdit ? TEACHER_MESSAGES.attendanceForm.attendanceUpdated
            : TEACHER_MESSAGES.attendanceForm.attendanceSubmitted
      )

      // Re-fetched rather than built from the DOM or reused from this
      // render's own studentRecords/teacherRecords: both of those are
      // missing something the *next* edit needs -- the DOM never had each
      // row's id in the first place (only data-student-id/data-teacher-id),
      // and this render's original studentRecords/teacherRecords still
      // reflect whatever was toggled BEFORE this save, not what was just
      // written. Getting real ids here means if the teacher immediately
      // clicks "Edit Attendance" again on the view this is about to render,
      // that click's update-in-place writes go through the row's actual id
      // (see the isEditingExisting branch above) instead of silently
      // matching nothing. One extra pair of queries, right after a save --
      // not on every render.
      const [{ data: freshStudentRecords }, { data: freshTeacherRecords }] = await Promise.all([
        supabase.from('attendance').select('id, student_id, status, needs_rework, marked_by').eq('class_id', myClass.id).eq('date', today),
        supabase.from('teacher_attendance').select('id, teacher_id, status').eq('class_id', myClass.id).eq('date', today)
      ])
      // The other group's status may have just changed underneath this one
      // (e.g. this teacher submitted Group 1 a minute ago and just now
      // finished Group 2) -- rebuilt fresh from the same query rather than
      // reusing whatever otherGroupsStatus this render started with.
      const freshOtherGroupsStatus = groupKey
        ? getGroupPartitions(myClass.students || [], myClass.class_groups || [])
            .filter(g => g.key !== groupKey)
            .map(g => buildGroupStatus(g, freshStudentRecords, buildNameByTeacherId(myClass)))
        : otherGroupsStatus
      renderAlreadySubmittedMessage(myClass, today, noteText, userId, {
        studentRecords: freshStudentRecords || [],
        teacherRecords: freshTeacherRecords || [],
        unavailableTeacherIds: unavailableIds,
        rosterStudents, groupKey, groupLabel, otherGroupsStatus: freshOtherGroupsStatus, onBackToGroups
      })
    }
  })
}

/**
 * Render the "History" tab: every past attendance date for this class,
 * newest first, each collapsed by default to just the date and a quick
 * present/absent count (see TEACHER_MESSAGES.history.dateSummary) --
 * expanding one (a plain `<details>`/`<summary>`, same pattern as
 * renderTeacherCalendar's "Past Dates" section) reveals the actual
 * breakdown: Present, then Absent, alphabetical by name within each --
 * split into the class's real groups first (see
 * data_import/85_class_groups_generalized.sql), if it has any, so a
 * teacher can cross-check a past day at a glance rather than scanning one
 * long mixed list. A class with no groups defined skips the group
 * sub-headings entirely and just shows the roster-wide Present/Absent
 * split, same as every class showed before this existed.
 *
 * Deliberately keyed off myClass.students/myClass.class_groups (this
 * class's CURRENT roster and groups, already fetched once by
 * renderTeacherDashboard) rather than trying to reconstruct either as they
 * stood on that historical date -- this app doesn't track roster or group
 * history anywhere else either (a student who's since changed grade or
 * optional class already shows the same way on every other past-facing
 * view), so this stays consistent with that rather than introducing a new
 * kind of historical snapshot just for this one tab.
 *
 * @param {object} myClass - The teacher's class row, including `.students`
 *   (each with `.class_group_id`) and `.class_groups` (each `{id, name}`).
 */
async function renderTeacherHistory(myClass) {
  const tabContent = document.getElementById('tab-content')
  const messages = TEACHER_MESSAGES.history

  // student_id (not just the nested students.full_name) is needed here to
  // look up each record's CURRENT group via groupIdByStudentId below.
  const { data: records } = await supabase
    .from('attendance')
    .select('date, status, student_id, students(full_name)')
    .eq('class_id', myClass.id)
    .order('date', { ascending: false })

  if (!records || records.length === 0) {
    tabContent.innerHTML = `<p>${messages.noRecordsYet}</p>`
    return
  }

  const groupIdByStudentId = new Map((myClass.students || []).map(s => [s.id, s.class_group_id || null]))
  const classGroups = myClass.class_groups || []
  const hasGroups = classGroups.length > 0
  // Real groups sorted by name (this class's own nested class_groups embed
  // carries no guaranteed order), same alphabetical convention the admin's
  // Class Groups tab itself fetches with.
  const sortedGroups = [...classGroups].sort((a, b) => (a.name || '').localeCompare(b.name || ''))

  // Group records by date, newest first (already the query's own order).
  const entriesByDate = new Map()
  records.forEach(r => {
    if (!entriesByDate.has(r.date)) entriesByDate.set(r.date, [])
    entriesByDate.get(r.date).push(r)
  })

  // Alphabetical by full_name (which is always "First Last" in this app's
  // data -- see every other student sort in this file) within one
  // present/absent bucket, rendered as plain name rows -- no per-row
  // status pill needed since the heading above each list already says
  // which bucket it is.
  const buildNameRows = (entries) => [...entries]
    .sort((a, b) => (a.students?.full_name || '').localeCompare(b.students?.full_name || ''))
    .map(e => `<div class="history-name-row">${toTitleCase(e.students?.full_name) || 'Unknown'}</div>`)
    .join('')

  const buildPresentAbsentHtml = (entries) => {
    const present = entries.filter(e => e.status === 'present')
    const absent = entries.filter(e => e.status !== 'present')
    return `
      <div class="history-status-block">
        <h5>${messages.presentHeading(present.length)}</h5>
        ${present.length > 0 ? buildNameRows(present) : `<p class="history-empty">${messages.nobodyPresent}</p>`}
      </div>
      <div class="history-status-block">
        <h5>${messages.absentHeading(absent.length)}</h5>
        ${absent.length > 0 ? buildNameRows(absent) : `<p class="history-empty">${messages.nobodyAbsent}</p>`}
      </div>
    `
  }

  const dateBlocksHtml = [...entriesByDate.entries()].map(([date, entries]) => {
    const presentCount = entries.filter(e => e.status === 'present').length

    const bodyHtml = hasGroups
      ? sortedGroups
          .map(g => {
            const groupEntries = entries.filter(e => groupIdByStudentId.get(e.student_id) === g.id)
            // Skip a group with zero records on this date entirely --
            // most classes will have far more dates than groups, and an
            // always-empty section for a group added after this date
            // (or one nobody in was ever marked for) would just be noise.
            if (groupEntries.length === 0) return ''
            return `
              <div class="history-group-block">
                <h4>${escapeHtml(g.name)}</h4>
                ${buildPresentAbsentHtml(groupEntries)}
              </div>
            `
          })
          .join('') +
        // Anyone with a record but no current group (e.g. added to the
        // roster, or ungrouped, since this date) -- same reasoning as
        // renderGroupPicker's own "Ungrouped Students" card: shown, not
        // silently folded into a group they were never actually part of.
        (() => {
          const ungroupedEntries = entries.filter(e => !groupIdByStudentId.get(e.student_id))
          if (ungroupedEntries.length === 0) return ''
          return `
            <div class="history-group-block">
              <h4>${TEACHER_MESSAGES.attendanceForm.groupPicker.ungroupedLabel}</h4>
              ${buildPresentAbsentHtml(ungroupedEntries)}
            </div>
          `
        })()
      : buildPresentAbsentHtml(entries)

    return `
      <details class="history-date-block">
        <summary>
          <span class="history-date">${date}</span>
          <span class="history-date-summary">${messages.dateSummary(presentCount, entries.length)}</span>
        </summary>
        ${bodyHtml}
      </details>
    `
  }).join('')

  tabContent.innerHTML = `
    <h3>${messages.heading(myClass.name)}</h3>
    ${dateBlocksHtml}
  `
}

/**
 * "Insights" tab: for this class's current roster, who's been most
 * reliably present and who's missed the most classes, all-time --
 * cumulative counts (not just a percentage), each with its own percentage
 * shown alongside for context, so "most absent" means "missed the most
 * classes" rather than something that quietly favors a student who's only
 * been on the roster a short while.
 *
 * Same "current roster, not a historical snapshot" scoping as
 * renderTeacherHistory right above -- a student who's since left the class
 * has no attendance rows counted here (they're not in myClass.students
 * any more to count them against), and a student who joined partway
 * through the year is compared on their own actual record, not penalized
 * for classes held before they were enrolled.
 *
 * A student with zero attendance rows on record at all (never once
 * marked, in either direction) is left out of both rankings entirely --
 * "most absent" should mean actually marked absent, not simply never
 * marked -- and called out in a single summary line instead, rather than
 * silently vanishing with no explanation for why the rankings look short
 * of the full roster.
 *
 * @param {object} myClass - The teacher's class row, including `.students`.
 */
async function renderInsightsTab(myClass) {
  const tabContent = document.getElementById('tab-content')
  const messages = TEACHER_MESSAGES.insights

  // Kudos categories/points (see the Kudos tab and data_import/86_
  // recognition_categories_and_points.sql, renamed to kudos_* by
  // data_import/88_rename_recognition_to_kudos.sql) are fetched
  // alongside attendance so the "By Category" section below can show each
  // category's own top-5 active students right here -- an at-a-glance
  // leaderboard, same spirit as Most Present/Most Absent, just sourced
  // from teacher-given points instead of attendance. Deliberately NOT
  // gated on the attendance query's own error check: a class's attendance
  // insights should still render even if, for whatever reason, the
  // kudos fetch hiccups -- see the "By Category" section below,
  // which just renders nothing when categories/recPoints come back empty.
  const [{ data: records, error }, { data: categories }, { data: recPoints }] = await Promise.all([
    supabase.from('attendance').select('student_id, status').eq('class_id', myClass.id),
    supabase.from('kudos_categories').select('id, name').eq('class_id', myClass.id).order('name'),
    supabase.from('kudos_points').select('category_id, student_id, points').eq('class_id', myClass.id)
  ])

  if (error) {
    tabContent.innerHTML = `<p class="error">${messages.loadError(error)}</p>`
    return
  }

  // Tally once per student, from this class's full attendance history --
  // cheaper than filtering the same array over and over per roster row.
  const statsByStudentId = new Map()
  ;(records || []).forEach(r => {
    if (!statsByStudentId.has(r.student_id)) statsByStudentId.set(r.student_id, { present: 0, total: 0 })
    const s = statsByStudentId.get(r.student_id)
    s.total += 1
    if (r.status === 'present') s.present += 1
  })

  const roster = myClass.students || []
  const withData = []
  const withoutData = []
  roster.forEach(s => {
    const stats = statsByStudentId.get(s.id)
    if (!stats || stats.total === 0) {
      withoutData.push(s)
      return
    }
    withData.push({
      name: toTitleCase(s.full_name),
      present: stats.present,
      absent: stats.total - stats.present,
      total: stats.total,
      presentPct: Math.round((stats.present / stats.total) * 100)
    })
  })

  const buildRankedRows = (entries, statFn) => entries
    .map((e, i) => `
      <div class="insight-row">
        <span class="insight-rank">${i + 1}.</span>
        <span class="insight-name">${e.name}</span>
        <span class="insight-stat">${statFn(e)}</span>
      </div>
    `)
    .join('')

  // Ranked by raw count first (ties broken by name) -- "most present"/
  // "most absent" reads as a cumulative leaderboard, not a rate, so a
  // long-enrolled student's real track record outranks a newcomer's small
  // sample. Top 5 each; a class with fewer than 5 students-with-data just
  // shows however many there are.
  const TOP_N = 5
  const mostPresent = [...withData]
    .sort((a, b) => b.present - a.present || a.name.localeCompare(b.name))
    .slice(0, TOP_N)
  const mostAbsent = [...withData]
    .filter(e => e.absent > 0)
    .sort((a, b) => b.absent - a.absent || a.name.localeCompare(b.name))
    .slice(0, TOP_N)

  // "By Category" -- each kudos category's own top-5 active
  // students, ranked by total points given in that category alone (same
  // rank-by-raw-total-then-name tie-break as Most Present/Most Absent
  // above, and the same computation renderKudosTab's leaderboard
  // uses, just scoped to one category at a time and capped at 5 instead of
  // 10 to match this tab's compact-card convention). A class with no
  // categories yet renders nothing here at all -- see categoriesHtml below.
  const nameByStudentId = new Map(roster.map(s => [s.id, toTitleCase(s.full_name)]))
  const categoryList = categories || []
  const pointsList = recPoints || []
  const categoryLeaderboards = categoryList.map(cat => {
    const totalsByStudent = new Map()
    pointsList
      .filter(p => p.category_id === cat.id)
      .forEach(p => totalsByStudent.set(p.student_id, (totalsByStudent.get(p.student_id) || 0) + p.points))
    const leaders = [...totalsByStudent.entries()]
      .map(([studentId, total]) => ({ studentId, name: nameByStudentId.get(studentId) || 'Unknown', total }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
      .slice(0, TOP_N)
    return { category: cat, leaders }
  })

  const categoriesHtml = categoryList.length > 0 ? `
    <h4>${messages.kudosHeading}</h4>
    <div class="insights-columns">
      ${categoryLeaderboards.map(({ category, leaders }) => `
        <div class="insights-card">
          <h4>${escapeHtml(category.name)}</h4>
          ${leaders.length > 0 ? buildRankedRows(leaders, e => TEACHER_MESSAGES.kudos.pointsStat(e.total)) : `<p class="history-empty">${messages.kudosEmpty}</p>`}
        </div>
      `).join('')}
    </div>
  ` : ''

  tabContent.innerHTML = `
    <h3>${messages.heading(myClass.name)}</h3>
    <p class="drag-hint">${messages.hint}</p>
    <div class="insights-columns">
      <div class="insights-card">
        <h4>${messages.mostPresentHeading}</h4>
        ${mostPresent.length > 0 ? buildRankedRows(mostPresent, e => messages.presentStat(e.present, e.total, e.presentPct)) : `<p class="history-empty">${messages.noDataYet}</p>`}
      </div>
      <div class="insights-card">
        <h4>${messages.mostAbsentHeading}</h4>
        ${mostAbsent.length > 0 ? buildRankedRows(mostAbsent, e => messages.absentStat(e.absent, e.total, 100 - e.presentPct)) : `<p class="history-empty">${messages.noDataYet}</p>`}
      </div>
    </div>
    ${withoutData.length > 0 ? `<p class="drag-hint">${messages.noRecordsNote(withoutData.length)}</p>` : ''}
    ${categoriesHtml}
  `
}

const KUDOS_LEADERBOARD_TOP_N = 10

/**
 * "Kudos" tab for teachers: teachers define their own named point
 * categories for a class (e.g. "Most Helpful", "Great Effort") and award
 * points to kids over time -- see data_import/86_recognition_categories_
 * and_points.sql's own doc comment for the full design (renamed to
 * kudos_* by data_import/88_rename_recognition_to_kudos.sql; categories are
 * shared with any co-teacher of this class; only the teacher who created a
 * category or gave a points award can rename/delete it). Points accumulate
 * into a leaderboard per category, plus one combined "Overall" leaderboard
 * across every category.
 *
 * Fetches once, then `renderKudosDetail` re-renders just the
 * category-pill/leaderboard/award panel from that same in-memory data when
 * switching between categories -- only a category or points write refetches
 * via a fresh call to this function.
 *
 * @param {object} myClass
 * @param {string} userId
 * @param {string|null} [selectedCategoryId] - null means the "Overall" view.
 */
async function renderKudosTab(myClass, userId, selectedCategoryId = null) {
  const tabContent = document.getElementById('tab-content')
  tabContent.innerHTML = '<p>Loading…</p>'
  const messages = TEACHER_MESSAGES.kudos

  const [{ data: categories, error: categoriesError }, { data: points, error: pointsError }] = await Promise.all([
    supabase.from('kudos_categories').select('id, name, created_by').eq('class_id', myClass.id).order('name'),
    supabase.from('kudos_points').select('id, category_id, student_id, points, teacher_id, note, awarded_at').eq('class_id', myClass.id).order('awarded_at', { ascending: false })
  ])

  const firstError = categoriesError || pointsError
  if (firstError) {
    tabContent.innerHTML = `<p class="error">${messages.loadError(firstError)}</p>`
    return
  }

  const roster = [...(myClass.students || [])].sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
  const nameByStudentId = new Map(roster.map(s => [s.id, toTitleCase(s.full_name)]))

  // A category that got deleted (by whoever created it) between page loads
  // shouldn't leave the panel stuck showing it -- fall back to Overall.
  const validSelection = selectedCategoryId && (categories || []).some(c => c.id === selectedCategoryId)
    ? selectedCategoryId
    : null

  tabContent.innerHTML = `
    <h3>${messages.heading(myClass.name)}</h3>
    <p class="drag-hint">${messages.hint}</p>
    <div id="kudos-detail"></div>
  `
  renderKudosDetail(myClass, userId, categories || [], points || [], nameByStudentId, roster, validSelection)
}

/**
 * Renders the category pills, leaderboard, award-points form (when a
 * specific category is selected), manage-categories panel, and recent
 * awards log into #kudos-detail -- everything below the tab's own
 * heading/hint, which `renderKudosTab` renders once and leaves alone.
 *
 * @param {object} myClass
 * @param {string} userId
 * @param {Array<{id: string, name: string, created_by: string}>} categories
 * @param {Array<{id: string, category_id: string, student_id: string, points: number, teacher_id: string, note: string|null, awarded_at: string}>} points
 * @param {Map<string, string>} nameByStudentId
 * @param {Array<object>} roster
 * @param {string|null} selectedCategoryId - null means "Overall".
 */
function renderKudosDetail(myClass, userId, categories, points, nameByStudentId, roster, selectedCategoryId) {
  const messages = TEACHER_MESSAGES.kudos
  const detail = document.getElementById('kudos-detail')

  const pointsInScope = selectedCategoryId
    ? points.filter(p => p.category_id === selectedCategoryId)
    : points // Overall: every category combined.

  const totalsByStudent = new Map()
  pointsInScope.forEach(p => {
    totalsByStudent.set(p.student_id, (totalsByStudent.get(p.student_id) || 0) + p.points)
  })
  const leaderboard = [...totalsByStudent.entries()]
    .map(([studentId, total]) => ({ studentId, name: nameByStudentId.get(studentId) || 'Unknown', total }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name))
    .slice(0, KUDOS_LEADERBOARD_TOP_N)

  const leaderboardRowsHtml = leaderboard.length > 0
    ? leaderboard.map((e, i) => `
        <div class="insight-row">
          <span class="insight-rank">${i + 1}.</span>
          <span class="insight-name">${e.name}</span>
          <span class="insight-stat">${messages.pointsStat(e.total)}</span>
        </div>
      `).join('')
    : `<p class="history-empty">${messages.leaderboardEmpty}</p>`

  const pillsHtml = `
    <div class="kudos-pills">
      <button type="button" class="kudos-pill${!selectedCategoryId ? ' active' : ''}" data-category-id="">${messages.overallLabel}</button>
      ${categories.map(c => `<button type="button" class="kudos-pill${c.id === selectedCategoryId ? ' active' : ''}" data-category-id="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
    </div>
  `

  const selectedCategory = selectedCategoryId ? categories.find(c => c.id === selectedCategoryId) : null

  // The award-points form and per-award edit/delete controls only make
  // sense once a specific category is selected -- "give points" always
  // means "in this category", and Overall is a read-only combined view.
  const awardFormHtml = selectedCategory ? `
    <div class="kudos-award-panel">
      <h4>${messages.awardHeading}</h4>
      <form id="kudos-award-form">
        <select id="kudos-award-student" required>
          <option value="">${messages.awardStudentPlaceholder}</option>
          ${roster.map(s => `<option value="${s.id}">${toTitleCase(s.full_name)}</option>`).join('')}
        </select>
        <input type="number" id="kudos-award-points" min="1" max="10" step="1" value="1" required />
        <input type="text" id="kudos-award-note" placeholder="${messages.awardNotePlaceholder}" />
        <button type="submit">${messages.awardButton}</button>
      </form>
      <p id="kudos-award-message" class="hidden"></p>
    </div>
  ` : ''

  const recentForScope = pointsInScope.slice(0, 15)
  const recentAwardsHtml = recentForScope.length > 0
    ? recentForScope.map(p => {
        const categoryName = selectedCategory ? selectedCategory.name : (categories.find(c => c.id === p.category_id)?.name || '')
        const isOwn = p.teacher_id === userId
        return `
          <div class="kudos-award-row" data-award-id="${p.id}" data-points="${p.points}">
            <div class="kudos-award-main">
              <span class="kudos-award-name">${nameByStudentId.get(p.student_id) || 'Unknown'}</span>
              <span class="kudos-award-points">${messages.pointsStat(p.points)}</span>
              ${!selectedCategory ? `<span class="kudos-award-category">${escapeHtml(categoryName)}</span>` : ''}
            </div>
            ${p.note ? `<div class="kudos-award-note">${escapeHtml(p.note)}</div>` : ''}
            ${isOwn ? `
              <div class="kudos-award-actions">
                <button type="button" class="kudos-award-edit-btn">${messages.editButton}</button>
                <button type="button" class="kudos-award-delete-btn">${messages.awardDeleteButton}</button>
              </div>
            ` : ''}
          </div>
        `
      }).join('')
    : `<p class="history-empty">${messages.noAwardsYet}</p>`

  const categoryRowsHtml = categories.map(c => `
    <div class="class-group-row" data-category-id="${c.id}">
      <span class="class-group-name">${escapeHtml(c.name)}</span>
      ${c.created_by === userId ? `
        <div class="class-group-row-actions">
          <button type="button" class="kudos-category-rename-btn">${messages.renameButton}</button>
          <button type="button" class="kudos-category-delete-btn">${messages.deleteButton}</button>
        </div>
      ` : ''}
    </div>
  `).join('')

  detail.innerHTML = `
    ${pillsHtml}
    <div class="insights-card kudos-leaderboard-card">
      <h4>${selectedCategory ? escapeHtml(selectedCategory.name) : messages.overallLabel}</h4>
      ${leaderboardRowsHtml}
    </div>
    ${awardFormHtml}
    <h4>${messages.recentAwardsHeading}</h4>
    <div id="kudos-award-list">${recentAwardsHtml}</div>
    <details class="kudos-manage-categories"${categories.length === 0 ? ' open' : ''}>
      <summary>${messages.manageCategoriesHeading}</summary>
      <div id="kudos-category-list">${categoryRowsHtml || `<p>${messages.noCategoriesYet}</p>`}</div>
      <div class="class-group-add-row">
        <input type="text" id="kudos-category-add-input" placeholder="${messages.addCategoryPlaceholder}" />
        <button type="button" id="kudos-category-add-btn">${messages.addCategoryButton}</button>
      </div>
      <p id="kudos-category-message" class="hidden"></p>
    </details>
  `

  wireKudosDetail(myClass, userId, categories, nameByStudentId, roster, selectedCategoryId)
}

/**
 * Wires everything renderKudosDetail just rendered: switching
 * category pills (re-renders from already-fetched data, no refetch),
 * add/rename/delete on categories, giving points, and edit/delete on a
 * teacher's own recent awards. Every write here re-fetches via
 * renderKudosTab on success -- same "always reload from the
 * database rather than patch the DOM" discipline as admin.js's Class
 * Groups tab, so the leaderboard, the recent-awards list and every
 * category pill always agree with what's actually saved.
 *
 * @param {object} myClass
 * @param {string} userId
 * @param {Array<{id: string, name: string, created_by: string}>} categories
 * @param {Map<string, string>} nameByStudentId
 * @param {Array<object>} roster
 * @param {string|null} selectedCategoryId
 */
function wireKudosDetail(myClass, userId, categories, nameByStudentId, roster, selectedCategoryId) {
  const messages = TEACHER_MESSAGES.kudos
  const detail = document.getElementById('kudos-detail')
  const catMsg = detail.querySelector('#kudos-category-message')
  const showCatMsg = (text, kind) => {
    if (!catMsg) return
    catMsg.textContent = text
    catMsg.className = kind
    catMsg.classList.remove('hidden')
  }

  // --- Switch category pill -- pure re-render, no network call ---------
  detail.querySelectorAll('.kudos-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      renderKudosTab(myClass, userId, btn.dataset.categoryId || null)
    })
  })

  // --- Add a category ----------------------------------------------------
  const addBtn = detail.querySelector('#kudos-category-add-btn')
  const addInput = detail.querySelector('#kudos-category-add-input')
  addBtn?.addEventListener('click', async () => {
    const name = addInput.value.trim()
    if (!name) {
      showCatMsg(messages.addCategoryNameRequired, 'error')
      return
    }
    addBtn.disabled = true
    const { error } = await supabase.from('kudos_categories').insert({ class_id: myClass.id, name, created_by: userId })
    addBtn.disabled = false
    if (error) {
      // Postgres' unique_violation code, from this table's unique(class_id,
      // name) constraint (see data_import/86_recognition_categories_and_
      // points.sql, renamed to kudos_categories by data_import/88_rename_
      // recognition_to_kudos.sql) -- a friendlier message than the raw
      // constraint text.
      showCatMsg(error.code === '23505' ? messages.addCategoryDuplicate : messages.addCategoryError(error), 'error')
      return
    }
    window.showToast(messages.categoryAdded(name))
    logAudit(
      userId, 'teacher', 'kudos_category.created', 'kudos_categories', null,
      `Added kudos category "${name}" to ${myClass.name}`,
      { class_id: myClass.id, name }
    )
    renderKudosTab(myClass, userId, null)
  })

  // --- Rename a category (own only -- see this row's markup) ------------
  detail.querySelectorAll('.kudos-category-rename-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.class-group-row')
      const categoryId = row.dataset.categoryId
      const nameSpan = row.querySelector('.class-group-name')
      const currentName = nameSpan.textContent
      row.querySelector('.class-group-row-actions').innerHTML = ''
      nameSpan.outerHTML = `
        <input type="text" class="class-group-rename-input" value="${escapeHtml(currentName)}" />
        <button type="button" class="kudos-category-rename-save-btn">${messages.renameSaveButton}</button>
        <button type="button" class="kudos-category-rename-cancel-btn">${messages.renameCancelButton}</button>
      `
      row.querySelector('.kudos-category-rename-cancel-btn').addEventListener('click', () => {
        renderKudosTab(myClass, userId, selectedCategoryId)
      })
      row.querySelector('.kudos-category-rename-save-btn').addEventListener('click', async () => {
        const newName = row.querySelector('.class-group-rename-input').value.trim()
        if (!newName) {
          showCatMsg(messages.renameNameRequired, 'error')
          return
        }
        const { error } = await supabase.from('kudos_categories').update({ name: newName }).eq('id', categoryId)
        if (error) {
          showCatMsg(error.code === '23505' ? messages.addCategoryDuplicate : messages.renameError(error), 'error')
          return
        }
        window.showToast(messages.categoryRenamed)
        logAudit(
          userId, 'teacher', 'kudos_category.renamed', 'kudos_categories', categoryId,
          `Renamed a ${myClass.name} kudos category "${currentName}" -> "${newName}"`,
          { class_id: myClass.id, category_id: categoryId, old_name: currentName, new_name: newName }
        )
        renderKudosTab(myClass, userId, selectedCategoryId)
      })
    })
  })

  // --- Delete a category (own only) --------------------------------------
  // Two-click confirm, same pattern as admin.js's Class Groups delete --
  // deleting a category also deletes every points award ever given in it
  // (on delete cascade, see the migration), so the confirm step matters
  // more here than most.
  detail.querySelectorAll('.kudos-category-delete-btn').forEach(btn => {
    let armed = false
    btn.addEventListener('click', async () => {
      const row = btn.closest('.class-group-row')
      const categoryId = row.dataset.categoryId
      const categoryName = row.querySelector('.class-group-name').textContent
      if (!armed) {
        armed = true
        btn.textContent = messages.deleteConfirmButton
        btn.classList.add('confirm-armed')
        return
      }
      btn.disabled = true
      const { error } = await supabase.from('kudos_categories').delete().eq('id', categoryId)
      if (error) {
        showCatMsg(messages.deleteError(error), 'error')
        btn.disabled = false
        armed = false
        btn.textContent = messages.deleteButton
        btn.classList.remove('confirm-armed')
        return
      }
      window.showToast(messages.categoryDeleted(categoryName))
      logAudit(
        userId, 'teacher', 'kudos_category.deleted', 'kudos_categories', categoryId,
        `Deleted kudos category "${categoryName}" from ${myClass.name}`,
        { class_id: myClass.id, category_id: categoryId, name: categoryName }
      )
      // The just-deleted category can't stay selected -- renderKudosTab
      // itself falls back to Overall when selectedCategoryId no longer
      // matches any fetched category, so passing it through here is safe.
      renderKudosTab(myClass, userId, selectedCategoryId === categoryId ? null : selectedCategoryId)
    })
  })

  // --- Give points ---------------------------------------------------
  const awardForm = detail.querySelector('#kudos-award-form')
  awardForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const awardMsgEl = detail.querySelector('#kudos-award-message')
    const showAwardMsg = (text, kind) => {
      awardMsgEl.textContent = text
      awardMsgEl.className = kind
      awardMsgEl.classList.remove('hidden')
    }

    const studentId = detail.querySelector('#kudos-award-student').value
    const pointsValue = Number(detail.querySelector('#kudos-award-points').value)
    const note = detail.querySelector('#kudos-award-note').value.trim()

    if (!studentId) {
      showAwardMsg(messages.awardStudentRequired, 'error')
      return
    }
    if (!Number.isInteger(pointsValue) || pointsValue < 1 || pointsValue > 10) {
      showAwardMsg(messages.awardPointsInvalid, 'error')
      return
    }

    const submitBtn = awardForm.querySelector('button[type="submit"]')
    submitBtn.disabled = true
    const { error } = await supabase.from('kudos_points').insert({
      class_id: myClass.id,
      category_id: selectedCategoryId,
      student_id: studentId,
      points: pointsValue,
      teacher_id: userId,
      note: note || null
    })
    submitBtn.disabled = false
    if (error) {
      showAwardMsg(messages.awardError(error), 'error')
      return
    }

    const studentName = nameByStudentId.get(studentId) || 'Unknown'
    const categoryName = categories.find(c => c.id === selectedCategoryId)?.name || ''
    window.showToast(messages.awarded(studentName, pointsValue, categoryName))
    logAudit(
      userId, 'teacher', 'kudos_points.awarded', 'kudos_points', null,
      `Gave ${studentName} ${pointsValue} point(s) in "${categoryName}" (${myClass.name})`,
      { class_id: myClass.id, category_id: selectedCategoryId, student_id: studentId, points: pointsValue, note: note || null }
    )
    renderKudosTab(myClass, userId, selectedCategoryId)
  })

  // --- Edit own award (amount + note) ------------------------------------
  detail.querySelectorAll('.kudos-award-edit-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.kudos-award-row')
      const awardId = row.dataset.awardId
      const currentPoints = row.dataset.points
      const currentNote = row.querySelector('.kudos-award-note')?.textContent || ''
      row.innerHTML = `
        <div class="kudos-award-edit-form">
          <input type="number" class="kudos-award-edit-points" min="1" max="10" step="1" value="${escapeHtml(currentPoints)}" />
          <input type="text" class="kudos-award-edit-note" value="${escapeHtml(currentNote)}" placeholder="${messages.awardNotePlaceholder}" />
          <button type="button" class="kudos-award-edit-save-btn">${messages.editSaveButton}</button>
          <button type="button" class="kudos-award-edit-cancel-btn">${messages.editCancelButton}</button>
        </div>
        <p class="kudos-award-edit-message hidden"></p>
      `
      row.querySelector('.kudos-award-edit-cancel-btn').addEventListener('click', () => {
        renderKudosTab(myClass, userId, selectedCategoryId)
      })
      row.querySelector('.kudos-award-edit-save-btn').addEventListener('click', async () => {
        const editMsgEl = row.querySelector('.kudos-award-edit-message')
        const newPoints = Number(row.querySelector('.kudos-award-edit-points').value)
        const newNote = row.querySelector('.kudos-award-edit-note').value.trim()
        if (!Number.isInteger(newPoints) || newPoints < 1 || newPoints > 10) {
          editMsgEl.textContent = messages.awardPointsInvalid
          editMsgEl.className = 'error'
          editMsgEl.classList.remove('hidden')
          return
        }
        const { error } = await supabase.from('kudos_points').update({ points: newPoints, note: newNote || null }).eq('id', awardId)
        if (error) {
          editMsgEl.textContent = messages.editError(error)
          editMsgEl.className = 'error'
          editMsgEl.classList.remove('hidden')
          return
        }
        window.showToast(messages.awardEdited)
        logAudit(
          userId, 'teacher', 'kudos_points.edited', 'kudos_points', awardId,
          `Edited a ${myClass.name} kudos points award to ${newPoints} point(s)`,
          { class_id: myClass.id, award_id: awardId, points: newPoints, note: newNote || null }
        )
        renderKudosTab(myClass, userId, selectedCategoryId)
      })
    })
  })

  // --- Delete own award ---------------------------------------------
  detail.querySelectorAll('.kudos-award-delete-btn').forEach(btn => {
    let armed = false
    btn.addEventListener('click', async () => {
      const row = btn.closest('.kudos-award-row')
      const awardId = row.dataset.awardId
      if (!armed) {
        armed = true
        btn.textContent = messages.awardDeleteConfirmButton
        btn.classList.add('confirm-armed')
        return
      }
      btn.disabled = true
      const { error } = await supabase.from('kudos_points').delete().eq('id', awardId)
      if (error) {
        window.showToast(messages.awardDeleteError(error))
        btn.disabled = false
        armed = false
        btn.textContent = messages.awardDeleteButton
        btn.classList.remove('confirm-armed')
        return
      }
      window.showToast(messages.awardDeleted)
      logAudit(
        userId, 'teacher', 'kudos_points.deleted', 'kudos_points', awardId,
        `Deleted a ${myClass.name} kudos points award`,
        { class_id: myClass.id, award_id: awardId }
      )
      renderKudosTab(myClass, userId, selectedCategoryId)
    })
  })
}

/**
 * "Calendar" tab for teachers: the same class_sessions schedule the admin
 * manages on the Calendar tab (see data_import/15_class_sessions.sql) --
 * date, label, type, and whether attendance is open, same as before, no
 * edit controls for any of that (still contact-your-admin territory). New:
 * each upcoming, attendance-open date now also carries an Available/
 * Unavailable toggle (see data_import/27_teacher_availability.sql) so a
 * teacher can mark whether they expect to be there, changeable any time by
 * tapping it again -- saves immediately, no separate submit step. Past
 * dates and closed dates stay purely read-only, same as before, since
 * there's nothing to mark availability FOR on either. Shown to every
 * registered teacher whether or not they have a class assigned yet (see
 * the no-class branch in renderTeacherDashboard above), split into
 * Upcoming (shown open) and a collapsed Past Dates section.
 *
 * @param {string} userId - Signed-in teacher's id -- whose own
 *   availability rows to load and save, and the actor attributed in the
 *   audit trail for every mark (see audit.js).
 */
async function renderTeacherCalendar(userId) {
  const tabContent = document.getElementById('tab-content')
  const today = todayStr()

  const [{ data: sessions, error }, { data: myAvailability }] = await Promise.all([
    supabase.from('class_sessions').select('*').order('session_date', { ascending: true }),
    // This teacher's own marks across the whole calendar -- cheap enough
    // to load in full alongside the sessions themselves rather than
    // re-querying per row.
    supabase.from('teacher_availability').select('session_date, status').eq('teacher_id', userId)
  ])

  if (error) {
    tabContent.innerHTML = `<p class="error">Couldn't load the calendar: ${error.message}</p>`
    return
  }

  const statusByDate = new Map((myAvailability || []).map(a => [a.session_date, a.status]))

  const allSessions = sessions || []
  const upcoming = allSessions.filter(s => s.session_date >= today)
  const past = allSessions.filter(s => s.session_date < today)
  const dayTypeLabels = { regular: 'Regular', special_event: 'Special event', holiday: 'Holiday' }

  // Availability is only markable on an upcoming date that's actually
  // open for attendance -- a holiday or an unopened special event has no
  // class to be available FOR, and a past date is moot either way.
  const buildRows = (list, markable) => list
    .map(s => {
      const canMark = markable && s.is_attendance_day
      // Defaults to 'available' when this teacher has never marked this
      // date -- see data_import/27_teacher_availability.sql and this
      // tab's hint text: everyone is assumed available unless they say
      // otherwise, so the toggle shows Available pre-selected rather than
      // neither button highlighted. No row is written just from this
      // default display -- only an actual click (Available or
      // Unavailable) upserts one, in wireAvailabilityToggles below.
      const status = statusByDate.get(s.session_date) || 'available'
      const availabilityHtml = canMark ? `
        <div class="status-toggle availability-toggle" data-session-date="${s.session_date}">
          <button type="button" class="toggle-btn available-btn${status === 'available' ? ' active' : ''}" data-status="available">${TEACHER_MESSAGES.availability.markAvailable}</button>
          <button type="button" class="toggle-btn unavailable-btn${status === 'unavailable' ? ' active' : ''}" data-status="unavailable">${TEACHER_MESSAGES.availability.markUnavailable}</button>
        </div>
      ` : ''
      return `
      <div class="session-row session-row-readonly${s.session_date === today ? ' session-row-today' : ''}">
        <span class="session-date">${s.session_date}${s.session_date === today ? ' <em>(Today)</em>' : ''}</span>
        <span class="session-label-text">${s.label}</span>
        <span class="session-type-badge">${dayTypeLabels[s.day_type] || s.day_type}</span>
        <span class="session-status-badge ${s.is_attendance_day ? 'session-open' : 'session-closed'}">${s.is_attendance_day ? 'Attendance Open' : 'Attendance Closed'}</span>
        ${availabilityHtml}
      </div>
    `
    })
    .join('') || '<p class="no-sessions">No dates in this section.</p>'

  tabContent.innerHTML = `
    <p class="drag-hint">The full HTYG schedule -- which dates classes meet, and which are holidays or special events. This is read-only; contact your admin to add or change a date.</p>
    <p class="drag-hint">${TEACHER_MESSAGES.availability.hint}</p>
    <h4>Upcoming</h4>
    <div class="session-list">${buildRows(upcoming, true)}</div>
    ${past.length > 0 ? `
      <details class="past-sessions">
        <summary>Past Dates (${past.length})</summary>
        <div class="session-list">${buildRows(past, false)}</div>
      </details>
    ` : ''}
  `

  wireAvailabilityToggles(tabContent, userId)
}

/**
 * Wires up every Available/Unavailable toggle rendered by
 * renderTeacherCalendar above -- one listener per button, scoped to its
 * own `.availability-toggle` group so clicking one never affects another
 * date's toggle. Saves on click via upsert (teacher_id, session_date) --
 * marking the same date again just overwrites the existing row rather
 * than erroring, so "change it any time" never needs a delete step first.
 *
 * @param {HTMLElement} tabContent
 * @param {string} userId
 */
function wireAvailabilityToggles(tabContent, userId) {
  tabContent.querySelectorAll('.availability-toggle').forEach(toggle => {
    const sessionDate = toggle.dataset.sessionDate
    toggle.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const status = btn.dataset.status
        // Optimistic highlight, reverted below if the save fails -- same
        // spirit as admin.js's Calendar tab toggle, so this feels
        // immediate rather than waiting on a round trip before anything
        // visibly changes.
        const previouslyActive = toggle.querySelector('.toggle-btn.active')
        toggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
        toggle.querySelectorAll('.toggle-btn').forEach(b => { b.disabled = true })

        const { error } = await supabase
          .from('teacher_availability')
          .upsert({ teacher_id: userId, session_date: sessionDate, status }, { onConflict: 'teacher_id,session_date' })

        toggle.querySelectorAll('.toggle-btn').forEach(b => { b.disabled = false })

        if (error) {
          showToast(TEACHER_MESSAGES.availability.couldntSave(error))
          toggle.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
          previouslyActive?.classList.add('active')
          return
        }

        showToast(status === 'available' ? TEACHER_MESSAGES.availability.savedAvailable : TEACHER_MESSAGES.availability.savedUnavailable)
        logAudit(
          userId, 'teacher', 'teacher_availability.marked', 'teacher_availability', null,
          `Marked ${status} for ${sessionDate}`,
          { session_date: sessionDate, status }
        )
      })
    })
  })
}

/**
 * "Log Hours" tab: lets a team's teacher (or "senior" -- this app has no
 * separate role for that, see DECISIONS.md) submit volunteer hours for
 * one or more students at once, on any day -- ad hoc, not gated by the
 * shared class_sessions attendance calendar the way Take Attendance is
 * (a team may not meet on the same schedule as regular classes). Only
 * shown at all when the signed-in teacher is assigned to at least one
 * volunteer team (see renderTeacherDashboard's volunteerTeams).
 *
 * Every submission here is unapproved (`approved: false`) -- the admin's
 * Volunteer Hours tab is where it actually becomes official, by accepting
 * or overriding it, the same way an admin reviews submitted attendance
 * rather than teachers marking students final themselves. See
 * data_import/23_volunteer_hours.sql.
 *
 * Eligibility (Madhyamshishyas/Yuvashishyas only, i.e. 6th-12th grade --
 * see VOLUNTEER_ELIGIBLE_GRADES) is enforced here by simply never listing
 * an ineligible student, not by a database-level rule.
 *
 * Each student's row also shows their attendance percentage (overall, and
 * over just the last 30 days -- see fetchAttendancePercentages) so a
 * teacher has that context right here while deciding who to give a
 * volunteer-hours opportunity to, instead of needing to go check the
 * admin's Records tab (which teachers don't have access to anyway).
 *
 * "Very easy to choose selected kids" is the point of the two-list layout
 * below: tapping a student in the available list moves them straight into
 * a separate Selected list beneath it, so a long roster gets shorter as
 * you go instead of staying just as cluttered with checkmarks buried in
 * it -- finding the *next* kid never means scanning past everyone you
 * already picked. Tapping a name in the Selected list moves them back. A
 * search box and grade filter narrow the available list (never touching
 * who's already selected, so narrowing by a second grade never loses a
 * first grade's picks), plus one-click Select All / Clear over whatever's
 * currently available.
 *
 * @param {Array} volunteerTeams - This teacher's volunteer-team class rows.
 * @param {string} userId - Signed-in teacher's id, recorded as `logged_by`.
 */
/**
 * Subtracts `days` whole days from a 'YYYY-MM-DD' date string, returning
 * another 'YYYY-MM-DD'. Parses at UTC noon (rather than midnight) purely
 * to keep the subtraction away from any midnight-adjacent DST edge --
 * since this only ever moves by whole days, the specific time of day
 * doesn't otherwise matter. Not a general-purpose date util -- just what
 * fetchAttendancePercentages needs for its 30-day cutoff, computed from
 * calendar.js's todayStr() (Central time) rather than the browser's own
 * local time, same reasoning as todayStr's own doc comment.
 *
 * @param {string} dateStr - 'YYYY-MM-DD'
 * @param {number} days
 * @returns {string} 'YYYY-MM-DD'
 */
function dateMinusDays(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

/**
 * Computes each student's overall attendance percentage and their
 * percentage over just the last 30 days, from every attendance row on
 * record for them across any class -- a student's grade homeroom and, if
 * they're opted into one, their Gita/Bhajan class both count, same as how
 * admin.js's Records tab tallies a student's attendance across whatever
 * classes appear in its date range. Used by the Log Hours tab so a teacher
 * can see this before deciding whether to give a student a volunteer-hours
 * opportunity -- see renderLogHoursTab.
 *
 * Requires data_import/35_teacher_view_all_attendance.sql to have been run
 * -- without it, RLS silently limits this query to whatever (if anything)
 * the teacher's own class-assignment already lets them see, understating
 * every other student's percentage rather than erroring outright.
 *
 * @param {string[]} studentIds
 * @returns {Promise<Map<string, {overallPct: number, last30Pct: number|null}>>}
 *   Keyed by student_id. A student with zero attendance rows on record at
 *   all has no entry in the returned map (renderLogHoursTab treats a
 *   missing entry as "no data yet"); one with rows overall but none in the
 *   last 30 days gets `last30Pct: null` while `overallPct` is still a
 *   real number.
 */
async function fetchAttendancePercentages(studentIds) {
  const result = new Map()
  if (studentIds.length === 0) return result

  const { data, error } = await supabase
    .from('attendance')
    .select('student_id, status, date')
    .in('student_id', studentIds)

  if (error || !data) {
    // Not surfaced as a form error -- the rest of the Log Hours tab (and
    // logging hours itself) works fine without this; a student's badge
    // just falls back to "no data yet" below instead.
    console.warn('attendance percentage lookup failed:', error?.message)
    return result
  }

  const cutoffStr = dateMinusDays(todayStr(), 30)

  // student_id -> running totals, tallied in one pass over every row.
  const totals = new Map()
  data.forEach(r => {
    if (!totals.has(r.student_id)) {
      totals.set(r.student_id, { present: 0, total: 0, presentLast30: 0, totalLast30: 0 })
    }
    const t = totals.get(r.student_id)
    t.total++
    if (r.status === 'present') t.present++
    // 'YYYY-MM-DD' strings compare the same as real dates would here,
    // since every date in this table is already stored in that exact
    // format -- no need to parse either side into a Date first.
    if (r.date >= cutoffStr) {
      t.totalLast30++
      if (r.status === 'present') t.presentLast30++
    }
  })

  totals.forEach((t, studentId) => {
    result.set(studentId, {
      overallPct: Math.round((t.present / t.total) * 100),
      last30Pct: t.totalLast30 > 0 ? Math.round((t.presentLast30 / t.totalLast30) * 100) : null
    })
  })

  return result
}

async function renderLogHoursTab(volunteerTeams, userId) {
  const tabContent = document.getElementById('tab-content')

  const { data: eligibleStudents, error } = await supabase
    .from('students')
    .select('id, full_name, grade_level')
    .in('grade_level', VOLUNTEER_ELIGIBLE_GRADES)

  if (error) {
    tabContent.innerHTML = `<p class="error">${LOG_HOURS_MESSAGES.submitError(error.message)}</p>`
    return
  }

  // Grade order, then name within a grade -- same canonical ordering used
  // throughout the admin dashboard.
  const gradeRank = new Map(GRADE_ORDER.map((g, i) => [g, i]))
  const sortedStudents = [...(eligibleStudents || [])].sort((a, b) => {
    const rankA = gradeRank.has(a.grade_level) ? gradeRank.get(a.grade_level) : GRADE_ORDER.length
    const rankB = gradeRank.has(b.grade_level) ? gradeRank.get(b.grade_level) : GRADE_ORDER.length
    if (rankA !== rankB) return rankA - rankB
    return (a.full_name || '').localeCompare(b.full_name || '')
  })

  // Attendance percentages -- see fetchAttendancePercentages's doc comment
  // and data_import/35_teacher_view_all_attendance.sql (the RLS policy
  // that lets this query see more than just the teacher's own class).
  // Computed once up front for the whole eligible roster, then stashed
  // directly on each student object, so filtering/searching the list below
  // never has to refetch.
  const attendanceByStudent = await fetchAttendancePercentages(sortedStudents.map(s => s.id))
  sortedStudents.forEach(s => {
    const stats = attendanceByStudent.get(s.id)
    s.overallPct = stats ? stats.overallPct : null
    s.last30Pct = stats ? stats.last30Pct : null
  })

  // A team picker only when this teacher actually has more than one team
  // -- the common case (one team) just names it, nothing to choose.
  const teamPickerHtml = volunteerTeams.length > 1 ? `
    <label>${LOG_HOURS_MESSAGES.teamSelectLabel}
      <select id="log-hours-team-select">
        ${volunteerTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')}
      </select>
    </label>
  ` : `<p class="log-hours-team-name"><strong>${volunteerTeams[0].name}</strong></p>`

  // Grade dropdown only lists grades that actually have an eligible student
  // in them, in canonical GRADE_ORDER (not insertion order) -- so it never
  // offers, say, "11th Grade" as a choice if this teacher's roster happens
  // to have none this year.
  const gradesPresent = GRADE_ORDER.filter(g => sortedStudents.some(s => s.grade_level === g))
  const gradeFilterHtml = gradesPresent.length > 1 ? `
    <select id="log-hours-grade-filter">
      <option value="">${LOG_HOURS_MESSAGES.allGradesOption}</option>
      ${gradesPresent.map(g => `<option value="${g}">${g}</option>`).join('')}
    </select>
  ` : ''

  tabContent.innerHTML = `
    <div class="section-header-row log-hours-top-row">
      <div class="log-hours-team-picker">${teamPickerHtml}</div>
      <input type="text" id="log-hours-note" form="log-hours-form" placeholder="${LOG_HOURS_MESSAGES.notePlaceholder}" required />
    </div>
    <form id="log-hours-form">
      <div class="log-hours-meta">
        <label>${LOG_HOURS_MESSAGES.dateLabel} <input type="date" id="log-hours-date" value="${todayStr()}" required /></label>
        <label>${LOG_HOURS_MESSAGES.hoursLabel} <input type="number" id="log-hours-hours" step="0.25" min="0.25" required /></label>
      </div>

      <h4>${LOG_HOURS_MESSAGES.studentsHeading}</h4>
      <div class="log-hours-controls">
        ${gradeFilterHtml}
        <input type="text" id="log-hours-search" placeholder="${LOG_HOURS_MESSAGES.searchPlaceholder}" />
        <button type="button" id="log-hours-select-all">${LOG_HOURS_MESSAGES.selectAllVisible}</button>
        <button type="button" id="log-hours-clear">${LOG_HOURS_MESSAGES.clearSelection}</button>
      </div>
      <div id="log-hours-student-list"></div>

      <h4 id="log-hours-selected-heading">${LOG_HOURS_MESSAGES.selectedHeading(0)}</h4>
      <div id="log-hours-selected-list"></div>

      <button type="submit" id="log-hours-submit" disabled>${LOG_HOURS_MESSAGES.submitButton(0)}</button>
      <p id="log-hours-message" class="hidden"></p>
    </form>
  `

  wireLogHoursForm(volunteerTeams, userId, sortedStudents)
}

/**
 * Wires up the Log Hours form: the two-list tap-to-select/tap-to-deselect
 * behavior (see renderLogHoursTab's doc comment), search + grade filtering
 * of the available list, Select All / Clear, and the batch submit itself
 * (one `volunteer_hours` row per selected student, all sharing the same
 * date/hours/note from the form).
 *
 * @param {Array} volunteerTeams - See renderLogHoursTab.
 * @param {string} userId
 * @param {Array} sortedStudents - Every eligible student, `{id, full_name,
 *   grade_level}`, in the grade-then-name order renderLogHoursTab sorted
 *   them into -- both lists below redraw from this plus `selectedIds`, so
 *   it's the only place either list's ordering comes from.
 */
function wireLogHoursForm(volunteerTeams, userId, sortedStudents) {
  const form = document.getElementById('log-hours-form')
  const searchInput = document.getElementById('log-hours-search')
  const selectAllBtn = document.getElementById('log-hours-select-all')
  const clearBtn = document.getElementById('log-hours-clear')
  const submitBtn = document.getElementById('log-hours-submit')
  const availableList = document.getElementById('log-hours-student-list')
  const selectedList = document.getElementById('log-hours-selected-list')
  const selectedHeading = document.getElementById('log-hours-selected-heading')
  const msg = document.getElementById('log-hours-message')
  // Only present when this teacher has more than one team -- see
  // renderLogHoursTab's teamPickerHtml.
  const teamSelect = document.getElementById('log-hours-team-select')
  // Only present when the eligible roster spans more than one grade -- see
  // renderLogHoursTab's gradeFilterHtml.
  const gradeFilter = document.getElementById('log-hours-grade-filter')

  const showMessage = (text, kind) => {
    msg.textContent = text
    msg.className = kind
    msg.classList.remove('hidden')
  }

  // The one source of truth for who's picked -- both lists are just two
  // views over this plus the current search/grade filter, fully redrawn
  // together on every change rather than edited in place, so they can
  // never drift out of sync with each other or with the submit button.
  const selectedIds = new Set()

  const matchesFilters = (s, term, grade) => {
    const nameMatch = term.length === 0 || toTitleCase(s.full_name).toLowerCase().includes(term)
    const gradeMatch = grade.length === 0 || s.grade_level === grade
    return nameMatch && gradeMatch
  }

  const rowHtml = (s) => `
    <button type="button" class="log-hours-student-row" data-id="${s.id}">
      <span class="log-hours-student-top">
        <span>${toTitleCase(s.full_name)}</span>
        <span class="log-hours-student-grade">${s.grade_level || ''}</span>
      </span>
      <span class="log-hours-student-attendance">${LOG_HOURS_MESSAGES.attendancePercentLabel(s.overallPct, s.last30Pct)}</span>
    </button>
  `

  // Redraws both lists from `selectedIds` plus the current search/grade
  // filter, and the submit button's count/enabled state -- called after
  // every change: search, grade filter, a tap in either list, Select All,
  // or Clear. A selected student never shows in the available list no
  // matter what the filter is currently set to (removing them from the
  // list you're browsing is the whole point -- see renderLogHoursTab's doc
  // comment); the Selected list, in turn, is never filtered by search/
  // grade at all, so narrowing the available list to look for one more
  // kid never hides someone already picked.
  const render = () => {
    const term = searchInput.value.trim().toLowerCase()
    const grade = gradeFilter ? gradeFilter.value : ''

    const available = sortedStudents.filter(s => !selectedIds.has(s.id) && matchesFilters(s, term, grade))
    availableList.innerHTML = available.map(rowHtml).join('') || `<p class="log-hours-empty-hint">${
      sortedStudents.length === 0 ? LOG_HOURS_MESSAGES.noEligibleStudents : LOG_HOURS_MESSAGES.noAvailableStudents
    }</p>`

    const selected = sortedStudents.filter(s => selectedIds.has(s.id))
    selectedList.innerHTML = selected.map(rowHtml).join('') || `<p class="log-hours-empty-hint">${LOG_HOURS_MESSAGES.noSelectedStudents}</p>`
    selectedHeading.textContent = LOG_HOURS_MESSAGES.selectedHeading(selected.length)

    // Fresh nodes every render (innerHTML above just replaced them), so
    // fresh listeners each time -- no stale handlers left over from a
    // previous render to worry about.
    availableList.querySelectorAll('.log-hours-student-row').forEach(row => {
      row.addEventListener('click', () => {
        selectedIds.add(row.dataset.id)
        render()
      })
    })
    selectedList.querySelectorAll('.log-hours-student-row').forEach(row => {
      row.addEventListener('click', () => {
        selectedIds.delete(row.dataset.id)
        render()
      })
    })

    // Starts disabled (see renderLogHoursTab's template) and only enables
    // once the teacher has actually picked someone -- "select a student"
    // is this form's version of "any task performed" (see DECISIONS.md),
    // so there's no way to submit an empty batch by accident.
    submitBtn.textContent = LOG_HOURS_MESSAGES.submitButton(selected.length)
    submitBtn.disabled = selected.length === 0
  }

  searchInput.addEventListener('input', render)
  if (gradeFilter) gradeFilter.addEventListener('change', render)

  // Adds every currently-available (i.e. matching the current search/
  // grade filter, not already selected) student to the selection -- same
  // "Select All Visible" scope the old checkbox list had.
  selectAllBtn.addEventListener('click', () => {
    const term = searchInput.value.trim().toLowerCase()
    const grade = gradeFilter ? gradeFilter.value : ''
    sortedStudents
      .filter(s => !selectedIds.has(s.id) && matchesFilters(s, term, grade))
      .forEach(s => selectedIds.add(s.id))
    render()
  })

  // Clears every selection, regardless of the current search/grade filter
  // -- same as the old checkbox list's Clear, which reset all checkboxes,
  // not just the ones currently visible.
  clearBtn.addEventListener('click', () => {
    selectedIds.clear()
    render()
  })

  render()

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const ids = [...selectedIds]
    const hours = Number(document.getElementById('log-hours-hours').value)
    const date = document.getElementById('log-hours-date').value
    const note = document.getElementById('log-hours-note').value.trim()
    const classId = teamSelect ? teamSelect.value : volunteerTeams[0].id

    // Belt-and-suspenders -- the button itself is disabled whenever
    // nothing's selected (see render), but this stays as a guard against
    // firing the request some other way (e.g. hitting Enter in a text
    // field).
    if (ids.length === 0) {
      showMessage(LOG_HOURS_MESSAGES.noStudentsSelected, 'error')
      return
    }
    if (!hours || hours <= 0) {
      showMessage(LOG_HOURS_MESSAGES.invalidHours, 'error')
      return
    }
    // Same belt-and-suspenders as the two checks above -- the `required`
    // attribute on the note field covers the normal case, this covers
    // anything that bypasses native form validation.
    if (!note) {
      showMessage(LOG_HOURS_MESSAGES.noteRequired, 'error')
      return
    }

    // Disabled for the whole request, not just after it settles -- same
    // double-click guard as the Take Attendance submit button (see
    // renderAttendanceForm), so this batch can't go in twice.
    submitBtn.disabled = true

    // One row per selected student, all unapproved -- see this tab's doc
    // comment on why nothing here is final until the admin reviews it.
    const records = ids.map(studentId => ({
      class_id: classId,
      student_id: studentId,
      date,
      hours,
      note,
      approved: false,
      logged_by: userId
    }))

    const { error } = await supabase.from('volunteer_hours').insert(records)
    if (error) {
      showMessage(LOG_HOURS_MESSAGES.submitError(error.message), 'error')
      // Let them retry -- the selection is still intact.
      submitBtn.disabled = false
      return
    }

    showMessage(LOG_HOURS_MESSAGES.submitted(ids.length), 'success')
    const teamName = volunteerTeams.find(t => t.id === classId)?.name || 'volunteer team'
    logAudit(
      userId, 'teacher', 'volunteer_hours.logged', 'volunteer_hours', null,
      `Logged ${hours} hrs for ${ids.length} student${ids.length === 1 ? '' : 's'} on ${date} (${teamName})`,
      { class_id: classId, team_name: teamName, date, hours, note, student_ids: ids }
    )
    selectedIds.clear()
    document.getElementById('log-hours-note').value = ''
    // Back to empty/disabled -- the selection that just submitted is
    // cleared, so there's nothing left to submit until they pick again.
    render()
  })
}

/**
 * Renders the "Smile Box" tab: a form for posting a quick, upbeat note
 * about a co-teacher or student -- "what made your day" -- plus the shared
 * wall of every such note anyone has posted, newest first. Every teacher
 * and admin sees the same wall (a "shared wall" design decision made when
 * this feature was built, not a private inbox); see
 * data_import/45_smile_box.sql for the RLS policies that make that so, and
 * for why nothing posted here can be edited or deleted from the UI
 * afterward.
 *
 * The search box lets a teacher tie a post to a specific person -- any
 * student or any teacher/admin in the whole program, not just their own
 * class or co-teachers (a deliberate choice: "co-teacher" could mean
 * someone from a completely different class). Picking a name is entirely
 * optional -- see wireSmileBoxForm's own doc comment for how a post
 * without a match, or without any name at all, still works.
 *
 * @param {string} userId - Signed-in teacher/admin's id.
 */
async function renderSmileBoxTab(userId) {
  const tabContent = document.getElementById('tab-content')
  tabContent.innerHTML = '<p>Loading…</p>'

  const [{ data: students, error: studentsError }, { data: people, error: peopleError }, { data: entries, error: entriesError }] = await Promise.all([
    supabase.from('students').select('id, full_name').order('full_name'),
    supabase.from('profiles').select('id, full_name').in('role', ['teacher', 'admin']).order('full_name'),
    supabase.from('smile_box_entries').select('id, author_teacher_id, subject_name, message, date, created_at').order('created_at', { ascending: false })
  ])

  const firstError = studentsError || peopleError || entriesError
  if (firstError) {
    tabContent.innerHTML = `<p class="error">${SMILE_BOX_MESSAGES.loadError(firstError)}</p>`
    return
  }

  // One flat, searchable roster -- every student plus every teacher/admin
  // -- each tagged with its type so a pick can be saved into the right
  // subject_student_id/subject_teacher_id column (see wireSmileBoxForm's
  // submit handler).
  const searchRoster = [
    ...(students || []).map(s => ({ id: s.id, name: toTitleCase(s.full_name), type: 'student' })),
    ...(people || []).map(p => ({ id: p.id, name: p.full_name, type: 'teacher' }))
  ]

  // Author display names for the wall, fetched as a separate query rather
  // than a PostgREST embed -- smile_box_entries has two separate foreign
  // keys into profiles (author_teacher_id and subject_teacher_id), so a
  // plain follow-up query sidesteps needing an embed-disambiguation hint
  // for something this simple.
  const authorIds = [...new Set((entries || []).map(e => e.author_teacher_id))]
  const { data: authors } = authorIds.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', authorIds)
    : { data: [] }
  const authorNameById = new Map((authors || []).map(a => [a.id, a.full_name]))

  tabContent.innerHTML = `
    <p class="smile-box-intro">${SMILE_BOX_MESSAGES.intro}</p>
    <form id="smile-box-form">
      <div class="smile-box-search-wrap">
        <input type="text" id="smile-box-search" placeholder="${SMILE_BOX_MESSAGES.searchPlaceholder}" autocomplete="off" />
        <div id="smile-box-search-results" class="smile-box-search-results hidden"></div>
      </div>
      <p id="smile-box-selected-name" class="smile-box-selected-name">${SMILE_BOX_MESSAGES.generalLabel}</p>
      <textarea id="smile-box-message" placeholder="${SMILE_BOX_MESSAGES.messagePlaceholder}" required></textarea>
      <button type="submit">${SMILE_BOX_MESSAGES.submitButton}</button>
      <p id="smile-box-form-message" class="hidden"></p>
    </form>

    <h3>${SMILE_BOX_MESSAGES.wallHeading}</h3>
    <div id="smile-box-wall">${buildSmileBoxWallHtml(entries || [], authorNameById)}</div>
  `

  wireSmileBoxForm(userId, searchRoster)
}

/**
 * Wires the Smile Box post form: live name search against `roster`,
 * picking a match, and posting. Picking a match is entirely optional --
 * "should work even when name is not there" was an explicit requirement
 * for this feature: a teacher can submit with no search text at all (a
 * general post, not about anyone specific), or type a name that matches
 * no one in the roster (a typo, or someone not in the system) and it's
 * still saved as free text in subject_name, just without a linked
 * subject_student_id/subject_teacher_id -- see the submit handler below.
 *
 * @param {string} userId
 * @param {Array<{id: string, name: string, type: 'student'|'teacher'}>} roster
 */
function wireSmileBoxForm(userId, roster) {
  const form = document.getElementById('smile-box-form')
  const searchInput = document.getElementById('smile-box-search')
  const resultsEl = document.getElementById('smile-box-search-results')
  const selectedNameEl = document.getElementById('smile-box-selected-name')
  const messageInput = document.getElementById('smile-box-message')
  const formMessageEl = document.getElementById('smile-box-form-message')
  const submitBtn = form.querySelector('button[type="submit"]')

  // The currently picked subject, or null for "no specific person" -- the
  // single source of truth the submit handler reads from. Typing in the
  // search box (even just one more character) clears this back to null,
  // so a stale pick can never silently survive a search that no longer
  // matches it -- see the 'input' listener below.
  let selected = null

  const updateSelectedLabel = () => {
    selectedNameEl.textContent = selected
      ? SMILE_BOX_MESSAGES.selectedLabel(selected.name)
      : SMILE_BOX_MESSAGES.generalLabel
  }

  searchInput.addEventListener('input', () => {
    selected = null
    updateSelectedLabel()

    const term = searchInput.value.trim().toLowerCase()
    if (term.length === 0) {
      resultsEl.classList.add('hidden')
      resultsEl.innerHTML = ''
      return
    }

    const matches = roster.filter(p => p.name.toLowerCase().includes(term)).slice(0, 8)
    resultsEl.innerHTML = matches.length > 0
      ? matches.map(p => `
          <button type="button" class="smile-box-result" data-id="${p.id}" data-type="${p.type}" data-name="${escapeHtml(p.name)}">
            ${escapeHtml(p.name)}<span class="smile-box-result-type">${p.type === 'student' ? 'Student' : 'Teacher'}</span>
          </button>
        `).join('')
      : `<p class="smile-box-no-match">${SMILE_BOX_MESSAGES.noMatches}</p>`
    resultsEl.classList.remove('hidden')

    resultsEl.querySelectorAll('.smile-box-result').forEach(btn => {
      btn.addEventListener('click', () => {
        selected = { id: btn.dataset.id, type: btn.dataset.type, name: btn.dataset.name }
        searchInput.value = btn.dataset.name
        updateSelectedLabel()
        resultsEl.classList.add('hidden')
        resultsEl.innerHTML = ''
      })
    })
  })

  form.addEventListener('submit', async (e) => {
    e.preventDefault()

    const message = messageInput.value.trim()
    formMessageEl.classList.add('hidden')

    if (!message) {
      formMessageEl.textContent = SMILE_BOX_MESSAGES.messageRequired
      formMessageEl.className = 'error'
      formMessageEl.classList.remove('hidden')
      return
    }

    // Whatever's currently typed in the search box becomes subject_name
    // verbatim, whether or not it matches a roster pick -- see this
    // function's own doc comment. Empty/whitespace means "not about
    // anyone specific", stored as null rather than an empty string.
    const typedName = searchInput.value.trim()

    submitBtn.disabled = true

    const { error } = await supabase.from('smile_box_entries').insert({
      author_teacher_id: userId,
      subject_student_id: selected?.type === 'student' ? selected.id : null,
      subject_teacher_id: selected?.type === 'teacher' ? selected.id : null,
      subject_name: typedName || null,
      message,
      date: todayStr()
    })

    if (error) {
      formMessageEl.textContent = SMILE_BOX_MESSAGES.submitError(error.message)
      formMessageEl.className = 'error'
      formMessageEl.classList.remove('hidden')
      submitBtn.disabled = false
      return
    }

    logAudit(
      userId, 'teacher', 'smile_box.posted', 'smile_box_entries', null,
      `Posted a Smile Box note${typedName ? ` about ${typedName}` : ''}`,
      {
        subject_name: typedName || null,
        subject_student_id: selected?.type === 'student' ? selected.id : null,
        subject_teacher_id: selected?.type === 'teacher' ? selected.id : null
      }
    )

    window.showToast(SMILE_BOX_MESSAGES.posted)
    // Full re-render rather than just prepending the new card -- simplest
    // way to keep the wall, the author-name lookup, and the reset form all
    // consistent with what's actually now in the database.
    renderSmileBoxTab(userId)
  })
}

/**
 * Builds the "Recent Smiles" wall -- every Smile Box entry, newest first.
 * Purely read-only: nothing rendered here is ever editable or deletable
 * from the UI (see data_import/45_smile_box.sql).
 *
 * @param {Array} entries - smile_box_entries rows (id, author_teacher_id,
 *   subject_name, message, date, created_at).
 * @param {Map<string, string>} authorNameById
 * @returns {string} HTML.
 */
function buildSmileBoxWallHtml(entries, authorNameById) {
  if (entries.length === 0) return `<p class="smile-box-empty">${SMILE_BOX_MESSAGES.empty}</p>`

  return entries.map(e => {
    const authorName = authorNameById.get(e.author_teacher_id) || 'A teacher'
    const subjectLine = e.subject_name ? SMILE_BOX_MESSAGES.aboutLabel(escapeHtml(e.subject_name)) : SMILE_BOX_MESSAGES.generalLabel
    const safeMessage = escapeHtml(e.message).replace(/\n/g, '<br>')
    return `
      <div class="smile-box-card">
        <div class="smile-box-card-top">
          <span class="smile-box-subject">${subjectLine}</span>
          <span class="smile-box-date">${e.date}</span>
        </div>
        <p class="smile-box-message">${safeMessage}</p>
        <p class="smile-box-author">— ${escapeHtml(authorName)}</p>
      </div>
    `
  }).join('')
}
