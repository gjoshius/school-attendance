/**
 * admin.js
 *
 * Renders the admin dashboard: a tabbed view for managing classes,
 * students, and browsing attendance records.
 *
 * Tabs:
 *  - Today: live status board showing which classes have submitted
 *    attendance today, updating in real time as teachers submit, plus a
 *    live dot on any class whose teacher currently has the attendance
 *    screen open right now (see renderTodayTab's teacher-presence viewer).
 *  - Classes: create classes and assign a teacher to each one.
 *  - Students: add students and assign them to a class.
 *  - Records: view attendance history, filterable by date range -- two
 *    separate sections under one shared filter: Student Attendance
 *    (per-class summaries + a detailed log) and Teacher Attendance (who
 *    actually showed up to teach each class -- see
 *    data_import/18_teacher_attendance.sql).
 *  - Volunteer Hours: review hours for non-grade teams (Yuvavani, Web
 *    Team, etc. -- see data_import/23_volunteer_hours.sql), per team.
 *    Teachers submit via teacher.js's Log Hours tab; this tab only
 *    accepts or overrides those submissions (same shape as the Today
 *    tab's review modal), plus totals by student and a day-by-day
 *    activity log of what's been accepted.
 *  - Class Groups: split any class into admin-defined groups (e.g.
 *    Bhajan's "Group 1"/"Group 2") and assign students into them -- see
 *    data_import/85_class_groups_generalized.sql. A class with no groups
 *    is completely unaffected everywhere else in the app; one that has at
 *    least one group shows a group picker on the teacher's own Take
 *    Attendance tab instead of a single roster (see teacher.js's
 *    renderGroupPicker), tracking each group's submission independently.
 *  - Calendar: manage the class_sessions schedule (which dates are
 *    regular classes, holidays, or special events).
 *  - Teacher Availability: read-only view, for a single selected date, of
 *    every teacher's availability (see data_import/27_teacher_availability.sql
 *    -- set by each teacher on their own Calendar tab) next to the
 *    classroom(s) they're normally assigned to.
 *  - Activity: a read-only audit trail (see data_import/24_audit_log.sql
 *    and src/audit.js) of every decision an admin or teacher has made
 *    that changed stored data -- who, what, and when -- filterable by
 *    date range and actor role.
 */

import { supabase } from './supabase.js'
import {
  toTitleCase, escapeHtml, OPTIONAL_CLASS_CODE_BY_NAME,
  GRADE_ORDER, GRADE_GROUPS, OTHER_GROUP_LABEL, GROUP_LABELS, gradeGroupLabel,
  VOLUNTEER_ELIGIBLE_GRADES
} from './format.js'
import { todayStr, getSessionForDate } from './calendar.js'
import { ADMIN_MESSAGES, RECORDS_FOLLOW_UP_ABSENCE_THRESHOLD } from './config.js'
import { logAudit } from './audit.js'
import { renderNavDrawer } from './nav.js'
// Shared with teacher.js so the lesson note (see
// data_import/30_class_lesson_notes.sql) renders as the exact same chat
// bubble in both the teacher's own locked view and here, in the review modal.
import { buildLessonNoteBubbleHtml } from './teacher.js'

// Admin dashboard's sections, in display order -- see renderAdminDashboard.
// Adding a new tab later only ever means adding one entry here (and its
// dispatcher branch below); the drawer nav itself (see nav.js) doesn't
// need to change to make room for it.
const ADMIN_TABS = [
  { key: 'today', label: 'Today' },
  { key: 'classes', label: 'Classes' },
  { key: 'students', label: 'Students' },
  { key: 'records', label: 'Records' },
  { key: 'volunteer', label: 'Volunteer Hours' },
  { key: 'groups', label: 'Class Groups' },
  { key: 'kudos', label: 'Kudos' },
  { key: 'calendar', label: 'Calendar' },
  { key: 'availability', label: 'Teacher Availability' },
  { key: 'activity', label: 'Activity' }
]

/**
 * Entry point for the admin view. Renders the tab navigation and wires up
 * tab switching, then shows the Today tab by default -- it's the one an
 * admin actually needs to check first on login (who's submitted
 * attendance today), so it leads the nav instead of sitting after the
 * class/student setup tabs.
 *
 * @param {HTMLElement} container - DOM element to render the dashboard into.
 * @param {string} userId - Supabase auth user id of the signed-in admin --
 *   threaded through to the Volunteer Hours tab, which stamps it as
 *   `logged_by`/`approved_by` on the entries it creates directly (see
 *   renderVolunteerHoursTab).
 */
export async function renderAdminDashboard(container, userId) {
  container.innerHTML = `
    <div id="nav-container"></div>
    <div id="tab-content"></div>
  `

  // Drawer nav (see nav.js) -- calls back with a tab's key whenever one is
  // picked; this is the same dispatch the old flat tab row's click handler
  // did, just no longer responsible for its own open/close/highlight
  // plumbing.
  renderNavDrawer(document.getElementById('nav-container'), ADMIN_TABS, 'today', (tabName) => {
    // Clean up Realtime subscriptions when leaving Today tab -- both the
    // attendance-submission channel and the teacher-presence viewer (see
    // renderTodayTab below for what each one does).
    ;['_attendanceChannel', '_teacherPresenceViewerChannel'].forEach(key => {
      if (window[key]) {
        supabase.removeChannel(window[key])
        window[key] = null
      }
    })

    if (tabName === 'classes') renderClassesTab(userId)
    else if (tabName === 'students') renderStudentsTab(userId)
    else if (tabName === 'records') renderRecordsTab(userId)
    else if (tabName === 'volunteer') renderVolunteerHoursTab(userId)
    else if (tabName === 'groups') renderClassGroupsTab(userId)
    else if (tabName === 'kudos') renderKudosTab()
    else if (tabName === 'today') renderTodayTab(userId)
    else if (tabName === 'calendar') renderCalendarTab(userId)
    else if (tabName === 'availability') renderTeacherAvailabilityTab()
    else if (tabName === 'activity') renderActivityTab()
  })

  // Show the Today tab by default
  renderTodayTab(userId)
}

/**
 * Today tab: a live status board of every class showing whether its
 * attendance has been submitted today, updating in real time as teachers
 * submit via a Supabase Realtime subscription (Postgres Changes on the
 * `attendance` table's INSERT/UPDATE events) -- plus a second, independent
 * Realtime subscription (Presence, not Postgres Changes) showing a live
 * dot on any class whose teacher currently has the attendance form open,
 * fed by teacher.js's trackTeacherPresence. The two are unrelated to each
 * other: a class can be "Waiting" with its teacher's dot lit (they're
 * looking at it right now, haven't submitted yet) just as easily as
 * "Submitted" with no dot (they submitted and moved on).
 *
 * @param {string} userId - Signed-in admin's id -- threaded through to
 *   openClassReviewModal so a Save/Reject in the review modal can be
 *   attributed to this admin in the audit trail (see audit.js).
 */
async function renderTodayTab(userId) {
  const tabContent = document.getElementById('tab-content')
  const today = todayStr()

  // Whether today itself is open for attendance -- see
  // data_import/15_class_sessions.sql -- shown in the heading below so
  // the admin can see at a glance why teachers might not have an
  // attendance form up today. To actually edit/add calendar dates, see
  // the dedicated Calendar tab (renderCalendarTab) -- this tab just
  // reports today's status, it doesn't manage the calendar.
  const todaySession = await getSessionForDate(today)

  // Fetch all classes with their assigned teachers -- a class can have
  // more than one, via the class_teachers join table (see
  // data_import/06_multi_teacher_classes.sql)
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, class_teachers(profiles(full_name))')

  // Fetch attendance records submitted today
  const { data: todayRecords } = await supabase
    .from('attendance')
    .select('class_id, needs_rework')
    .eq('date', today)

  // Collect the IDs of classes that already submitted, and separately the
  // ones an admin has since flagged for rework (see
  // data_import/22_attendance_rework_flag.sql) -- a class can only be in
  // one of the three Today-tab states (waiting / submitted / needs rework),
  // so needs-rework takes priority below since it implies rows exist too.
  const submittedClassIds = new Set(
    (todayRecords || []).map(r => r.class_id)
  )
  const reworkClassIds = new Set(
    (todayRecords || []).filter(r => r.needs_rework).map(r => r.class_id)
  )

  // Sort classes into grade order (Kindergarten, 1st Grade, 2nd Grade, ...)
  // when the class name matches a known grade; anything else (e.g. a
  // custom class name) sorts after all grades, alphabetically.
  const sortedClasses = [...(classes || [])].sort((a, b) => {
    const rankA = GRADE_ORDER.indexOf(a.name)
    const rankB = GRADE_ORDER.indexOf(b.name)
    const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
    const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })

  // Build one status card's HTML for a class. Every card gets a
  // clickable badge regardless of its current submitted state -- not just
  // the ones already submitted at render time -- so a card that flips
  // from Waiting to Submitted live (see the Realtime handler below) is
  // clickable immediately, with no extra wiring needed at flip time. The
  // click handler itself checks the card's *live* class list, not this
  // snapshot, before doing anything. The review panel itself opens in a
  // shared modal (see #review-modal-overlay below) rather than inline in
  // the card, so opening it never pushes the rest of the board down or
  // requires scrolling to find it.
  const buildStatusCard = c => {
    const needsRework = reworkClassIds.has(c.id)
    const submitted = submittedClassIds.has(c.id)
    const state = needsRework ? 'needs-rework' : submitted ? 'submitted' : 'waiting'
    const label = needsRework ? ADMIN_MESSAGES.today.reworkBadge : submitted ? 'Submitted' : 'Waiting'
    // A class can have more than one teacher -- list all of them
    const teacherNames = (c.class_teachers || [])
      .map(ct => toTitleCase(ct.profiles?.full_name))
      .filter(Boolean)
      .join(', ') || ADMIN_MESSAGES.classes.unassignedBadge
    return `
      <div class="status-card ${state}" data-class-id="${c.id}" data-class-name="${c.name}">
        <strong>${c.name}</strong>
        <span class="teacher-name">${teacherNames}</span>
        <span class="presence-dot" title="A teacher currently has this class's attendance screen open"></span>
        <span class="status-badge status-badge-clickable">${label}</span>
      </div>
    `
  }

  // Group classes under their named age-group heading (Balashishyas,
  // Madhyamshishyas, Yuvashishyas -- see GRADE_GROUPS), then Special
  // Classes (Gita/Bhajan -- see format.js's SPECIAL_CLASS_LABEL), with
  // anything else (a volunteer team, any other custom class name)
  // collected under "Other Classes" at the end. Order within each group's
  // grid keeps the grade-order sort already applied above.
  const classesByGroup = new Map(GROUP_LABELS.map(label => [label, []]))
  sortedClasses.forEach(c => {
    classesByGroup.get(gradeGroupLabel(c.name) || OTHER_GROUP_LABEL).push(c)
  })

  const sections = GROUP_LABELS
    .map(label => {
      const groupClasses = classesByGroup.get(label)
      if (groupClasses.length === 0) return ''
      const cards = groupClasses.map(buildStatusCard).join('')
      return `<h4>${label}</h4><div class="status-grid">${cards}</div>`
    })
    .join('')

  // Heading notes today's calendar status right alongside the date, so
  // it's obvious at a glance why teachers might not have an attendance
  // form up right now (see data_import/15_class_sessions.sql).
  const todayStatusNote = ADMIN_MESSAGES.today.statusNote(todaySession)

  // Render the status board into the tab content area. The review modal
  // itself is NOT part of this markup -- see openClassReviewModal, which
  // builds it fresh and appends it straight to <body> only once its data
  // has actually loaded, rather than pre-creating an empty/hidden shell
  // here for it to be filled in later.
  tabContent.innerHTML = `
    <div id="pending-volunteer-card"></div>
    <h3>Today's Attendance — ${today}${todayStatusNote}</h3>
    <div id="status-board">${sections || `<p>${ADMIN_MESSAGES.today.noClassesCreatedYet}</p>`}</div>
  `

  renderPendingVolunteerHoursCard()

  // Clicking a class's status badge opens its review panel in a modal --
  // but only when there's actually something to review right now, i.e. the
  // card is submitted or flagged needs-rework (checked live, not from the
  // snapshot this card was built from -- see buildStatusCard above for why
  // that distinction matters; a needs-rework card still has real rows
  // behind it, just flagged, so it's just as reviewable). The badge's own
  // text is used as a loading indicator while the fetch is in flight, and
  // clicks are ignored until it settles, so there's no way to fire two
  // overlapping opens from the same badge.
  tabContent.querySelectorAll('.status-badge-clickable').forEach(badge => {
    badge.addEventListener('click', async () => {
      const card = badge.closest('.status-card')
      const reviewable = card.classList.contains('submitted') || card.classList.contains('needs-rework')
      if (!reviewable || badge.classList.contains('loading')) return
      const originalLabel = badge.textContent
      badge.classList.add('loading')
      badge.textContent = ADMIN_MESSAGES.today.loadingReview
      await openClassReviewModal(card.dataset.classId, card.dataset.className, today, userId)
      badge.classList.remove('loading')
      badge.textContent = originalLabel
    })
  })

  // Flips a status card to one of the three states in place -- shared by
  // both Realtime handlers below so a live INSERT (first submission) and a
  // live UPDATE (a reject setting needs_rework, or a teacher resubmitting
  // and clearing it) render the same way.
  const setCardStatus = (card, state) => {
    card.classList.remove('waiting', 'submitted', 'needs-rework')
    card.classList.add(state)
    const label = state === 'needs-rework' ? ADMIN_MESSAGES.today.reworkBadge : state === 'submitted' ? 'Submitted' : 'Waiting'
    card.querySelector('.status-badge').textContent = label
  }

  // Clean up any previous subscription -- always, even on a closed day,
  // in case one was left open from an earlier open day this same session
  // (e.g. the calendar changed today's status, or this is a stale channel
  // from before a page-visibility resume).
  if (window._attendanceChannel) {
    supabase.removeChannel(window._attendanceChannel)
    window._attendanceChannel = null
  }
  if (window._teacherPresenceViewerChannel) {
    supabase.removeChannel(window._teacherPresenceViewerChannel)
    window._teacherPresenceViewerChannel = null
  }

  // Only subscribe to Realtime at all when today is actually an
  // attendance-open day (see data_import/15_class_sessions.sql) -- in
  // practice, only Saturdays with a class scheduled. On any other day,
  // no teacher's attendance form is ever open (teacher.js's own
  // is_attendance_day check keeps trackTeacherPresence from firing then
  // too), so there's nothing for either channel to ever report -- just
  // constant background Realtime overhead for a board that can't change.
  // The Today tab is every admin's default landing tab, so without this
  // gate these channels were open effectively 24/7, every day of the
  // week, not just the one day they could ever do anything.
  if (!todaySession?.is_attendance_day) return

  // Subscribe to attendance inserts (first submission of the day) and
  // updates (a reject flips a card to Needs Rework; a teacher's resubmit --
  // see teacher.js's renderAttendanceForm -- flips it back by clearing
  // needs_rework) so the board reflects both without a manual refresh.
  window._attendanceChannel = supabase
    .channel('attendance-today')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'attendance' },
      (payload) => {
        const classId = payload.new.class_id
        const card = tabContent.querySelector(`.status-card[data-class-id="${classId}"]`)
        if (card && card.classList.contains('waiting')) {
          setCardStatus(card, payload.new.needs_rework ? 'needs-rework' : 'submitted')

          // Find the class name for the toast
          const className = card.querySelector('strong').textContent
          showToast(ADMIN_MESSAGES.today.attendanceSubmitted(className))
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'attendance' },
      (payload) => {
        const classId = payload.new.class_id
        const card = tabContent.querySelector(`.status-card[data-class-id="${classId}"]`)
        if (!card) return
        setCardStatus(card, payload.new.needs_rework ? 'needs-rework' : 'submitted')
      }
    )
    .subscribe()

  // Live "a teacher currently has this open" dot -- separate channel from
  // the attendance-submission one above, joined to the SAME channel name a
  // teacher's own dashboard broadcasts to while their attendance form is
  // open (see teacher.js's trackTeacherPresence). This side only ever
  // listens -- it never calls .track() itself, so an admin viewing this
  // tab never shows up as "present" on any class. `sync` fires with the
  // full current presence state (not just what changed), so it's simplest
  // to just recompute which classes are live and re-toggle every card's
  // dot each time, rather than tracking joins/leaves incrementally.
  window._teacherPresenceViewerChannel = supabase
    .channel('teacher-presence')
    .on('presence', { event: 'sync' }, () => {
      const state = window._teacherPresenceViewerChannel.presenceState()
      // String(...) on both sides -- card.dataset.classId is always a
      // string (DOM dataset attributes always are), but p.class_id came
      // over the wire from teacher.js's .track({ class_id: myClass.id })
      // and, depending on whatever type `classes.id` actually is in
      // Postgres, could arrive as a JS number instead. A Set uses strict
      // equality, so a number/string mismatch there would silently mean
      // liveClassIds.has(...) never matches -- no error, just a dot that
      // never lights up. Cheap enough to always normalize rather than
      // depend on the id type never changing.
      const liveClassIds = new Set(Object.values(state).flat().map(p => String(p.class_id)))
      tabContent.querySelectorAll('.status-card').forEach(card => {
        card.classList.toggle('teacher-present', liveClassIds.has(card.dataset.classId))
      })
    })
    .subscribe()
}

/**
 * Renders (or, when there's nothing pending, deliberately renders nothing
 * into) the Today tab's Pending Volunteer Hours card -- a single at-a-
 * glance count of unapproved volunteer-hours submissions across every
 * team, so an admin sees this without visiting the Volunteer Hours tab
 * first. Clicking its Review button jumps there directly (by clicking the
 * drawer nav's own "Volunteer Hours" entry, so it goes through the exact
 * same tab-switch path a manual click would -- see nav.js's
 * renderNavDrawer). Only ever counts unapproved rows; see
 * renderVolunteerPendingSection for the full cross-team pending list this
 * card is pointing at.
 */
async function renderPendingVolunteerHoursCard() {
  const card = document.getElementById('pending-volunteer-card')
  if (!card) return // tab may have been switched away from mid-fetch

  const { data: pending, error } = await supabase
    .from('volunteer_hours')
    .select('id')
    .eq('approved', false)

  if (error) {
    // Silently skip rather than showing an error card on the main
    // screen for something the Volunteer Hours tab already surfaces
    // (and can retry) on its own.
    console.error('Error checking pending volunteer hours:', error)
    return
  }

  const count = (pending || []).length
  if (count === 0) {
    card.innerHTML = ''
    return
  }

  card.innerHTML = `
    <div class="pending-volunteer-card">
      <div class="pending-volunteer-card-text">
        <strong>${ADMIN_MESSAGES.today.pendingVolunteerHeading(count)}</strong>
        <span>${ADMIN_MESSAGES.today.pendingVolunteerHint}</span>
      </div>
      <button type="button" id="pending-volunteer-review-btn">${ADMIN_MESSAGES.today.pendingVolunteerReviewLabel}</button>
    </div>
  `

  document.getElementById('pending-volunteer-review-btn').addEventListener('click', () => {
    document.querySelector('.nav-drawer-panel .tab[data-tab="volunteer"]')?.click()
  })
}

/**
 * Opens a review modal for one class -- lets the admin see and edit an
 * already-submitted class's student and teacher attendance for today in
 * place, or reject it for rework entirely (see wireReviewPanel below and
 * data_import/19_admin_attendance_management.sql for the RLS this needs).
 *
 * Rewritten to build the modal from scratch on every open rather than
 * reusing a persistent hidden shell: fetches the data FIRST, and only
 * creates and inserts the modal's DOM (appended straight to <body>, not
 * nested inside the Today tab's own markup) once there's real content --
 * or a real error message -- to put in it. There is deliberately no
 * "loading" state rendered inside the modal itself (the calling click
 * handler in renderTodayTab shows that on the badge instead) and no
 * shared node mutated across the fetch's await boundary, so there's no
 * window where a click can leave a half-built or stuck-blank modal
 * on-screen -- the modal simply doesn't exist until it has something
 * real to show.
 *
 * @param {string} classId
 * @param {string} className
 * @param {string} today - 'YYYY-MM-DD'
 * @param {string} userId - Signed-in admin's id -- see wireReviewPanel,
 *   which stamps this on every audit_log row a Save/Reject in this modal
 *   writes.
 */
async function openClassReviewModal(classId, className, today, userId) {
  // Never more than one of these open at a time.
  closeClassReviewModal()

  let studentRecords, teacherRecords, lessonNote
  try {
    // `profiles!teacher_attendance_teacher_id_fkey` disambiguates which of
    // teacher_attendance's two foreign keys into profiles (teacher_id vs.
    // marked_by) this embed follows -- same reasoning as the Records tab's
    // teacher attendance query. The lesson note (see
    // data_import/30_class_lesson_notes.sql) is fetched alongside so the
    // admin can verify what was taught, right here, without a separate tab.
    const [studentRes, teacherRes, noteRes] = await Promise.all([
      supabase.from('attendance').select('id, status, needs_rework, students(full_name)').eq('class_id', classId).eq('date', today),
      supabase.from('teacher_attendance').select('id, teacher_id, status, needs_rework, profiles!teacher_attendance_teacher_id_fkey(full_name)').eq('class_id', classId).eq('date', today),
      supabase.from('class_lesson_notes').select('note').eq('class_id', classId).eq('date', today).maybeSingle()
    ])
    if (studentRes.error || teacherRes.error) throw (studentRes.error || teacherRes.error)
    studentRecords = studentRes.data
    teacherRecords = teacherRes.data
    lessonNote = noteRes.data
  } catch (err) {
    // Caught, not just checking each query's .error field -- a dropped
    // connection throws outright rather than resolving with an error
    // object. Either way, a toast (not a broken modal) is the result.
    console.error('Error loading review panel:', err)
    showToast(ADMIN_MESSAGES.today.errorLoadingReview)
    return
  }

  // Already flagged from a previous reject and still waiting on the
  // teacher -- there's nothing for the admin to do here until the teacher
  // fixes and resubmits (see teacher.js's renderAttendanceForm), so this
  // view goes read-only: rows show as plain (non-interactive) status
  // pills, and the Save Changes / Reject for Rework actions don't render
  // at all rather than sitting there enabled with nothing useful to do.
  // Every row shares the same flag, since reject/resubmit both act on the
  // whole class+day at once -- checking the first is enough.
  const alreadyFlagged = (studentRecords || []).some(r => r.needs_rework) || (teacherRecords || []).some(r => r.needs_rework)

  const buildReviewRow = (rowClass, id, name, status, extraAttrs = '') => `
    <div class="${rowClass}${alreadyFlagged ? ' read-only' : ''}" data-record-id="${id}"${extraAttrs}>
      <span>${name}</span>
      <div class="status-toggle">
        <button class="toggle-btn present-btn${status === 'present' ? ' active' : ''}" data-status="present"${alreadyFlagged ? ' disabled' : ''}>Present</button>
        <button class="toggle-btn absent-btn${status === 'absent' ? ' active' : ''}" data-status="absent"${alreadyFlagged ? ' disabled' : ''}>Absent</button>
      </div>
    </div>
  `

  const studentRows = [...(studentRecords || [])]
    .sort((a, b) => (a.students?.full_name || '').localeCompare(b.students?.full_name || ''))
    .map(r => buildReviewRow('review-student-row', r.id, toTitleCase(r.students?.full_name), r.status))
    .join('')

  // Each teacher row carries data-teacher-id (not just its own
  // teacher_attendance record id) so wireReviewPanel's Save can look up
  // this same person's OTHER classes -- see that function's own doc
  // comment on why marking someone absent here also cascades there.
  const teacherRows = [...(teacherRecords || [])]
    .sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
    .map(r => buildReviewRow('review-teacher-row', r.id, toTitleCase(r.profiles?.full_name), r.status, ` data-teacher-id="${r.teacher_id}"`))
    .join('')

  const reworkNoticeHtml = alreadyFlagged ? `<p class="review-rework-notice">${ADMIN_MESSAGES.today.reworkPendingNotice}</p>` : ''
  const actionsHtml = alreadyFlagged ? '' : `
    <div class="review-actions">
      <button class="save-review-btn">${ADMIN_MESSAGES.today.saveChangesLabel}</button>
      <button class="reject-review-btn">${ADMIN_MESSAGES.today.rejectLabel}</button>
    </div>
  `

  // The "what was taught today" note (see data_import/30_class_lesson_notes.sql),
  // shown as the same chat bubble teacher.js renders on the teacher's own
  // locked view -- shared via buildLessonNoteBubbleHtml so it reads
  // identically in both places. Falls back to a plain "no note" line rather
  // than an empty section when nothing was written.
  const lessonNoteBubbleHtml = buildLessonNoteBubbleHtml(lessonNote?.note)
  const lessonNoteSectionHtml = `
    <h5>${ADMIN_MESSAGES.today.lessonNoteHeading}</h5>
    ${lessonNoteBubbleHtml || `<p class="lesson-note-bubble-empty">${ADMIN_MESSAGES.today.lessonNoteEmpty}</p>`}
  `

  const overlay = document.createElement('div')
  overlay.id = 'review-modal-overlay'
  overlay.className = 'review-modal-overlay'
  overlay.innerHTML = `
    <div class="review-modal" id="review-modal">
      <button class="review-modal-close" aria-label="Close">&times;</button>
      <h4>${className}</h4>
      ${reworkNoticeHtml}
      <h5>${ADMIN_MESSAGES.today.reviewStudentsHeading}</h5>
      <div class="review-list">${studentRows || `<p>${ADMIN_MESSAGES.today.reviewNoStudents}</p>`}</div>
      ${teacherRows ? `<h5>${ADMIN_MESSAGES.today.reviewTeachersHeading}</h5><div class="review-list">${teacherRows}</div>` : ''}
      ${lessonNoteSectionHtml}
      ${actionsHtml}
      <p class="review-message hidden"></p>
    </div>
  `
  document.body.appendChild(overlay)

  // Clicking the dimmed backdrop, the close button, or pressing Escape all
  // close it the same way.
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeClassReviewModal()
  })
  overlay.querySelector('.review-modal-close').addEventListener('click', closeClassReviewModal)
  document.addEventListener('keydown', escKeyClosesReviewModal)

  wireReviewPanel(overlay.querySelector('.review-modal'), classId, className, today, alreadyFlagged, userId)
}

/** Removes the review modal from the page entirely, if one is open. */
function closeClassReviewModal() {
  document.getElementById('review-modal-overlay')?.remove()
  document.removeEventListener('keydown', escKeyClosesReviewModal)
}

/** Escape-key handler for the review modal -- see openClassReviewModal. */
function escKeyClosesReviewModal(e) {
  if (e.key === 'Escape') closeClassReviewModal()
}

/**
 * Wires up an open review modal's toggle buttons, "Save Changes"
 * (updates each record in place), and "Reject for Rework" (flags both the
 * student attendance AND teacher attendance for this class+day as
 * needs_rework -- see data_import/22_attendance_rework_flag.sql -- so the
 * teacher's "Take Attendance" tab reopens pre-filled with their original
 * submission instead of either the locked "already submitted" view or a
 * blank form). Called once per openClassReviewModal open, right after its
 * HTML is inserted.
 *
 * @param {HTMLElement} panel - The #review-modal element.
 * @param {string} classId
 * @param {string} className
 * @param {string} today - 'YYYY-MM-DD'
 * @param {boolean} readOnly - Whether this class is already flagged for
 *   rework -- openClassReviewModal renders that state with no toggle
 *   buttons or action buttons in the DOM at all (nothing to do until the
 *   teacher resubmits), so there's nothing here to wire up either.
 * @param {string} userId - Signed-in admin's id, recorded as the actor on
 *   every audit_log row Save/Reject writes (see audit.js).
 */
function wireReviewPanel(panel, classId, className, today, readOnly, userId) {
  if (readOnly) return

  // Make toggle buttons switch between Present and Absent within each row
  // (shared by both student and teacher rows)
  panel.querySelectorAll('.review-student-row, .review-teacher-row').forEach(row => {
    row.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })
  })

  const msg = panel.querySelector('.review-message')
  const showReviewMessage = (text, kind) => {
    msg.textContent = text
    msg.className = `review-message ${kind}`
    msg.classList.remove('hidden')
  }

  // Save: update each row in place -- doesn't touch alreadySubmitted on
  // the teacher's side, since the records still exist either way.
  //
  // Marking a teacher Absent here also cascades: a teacher's actual
  // presence at HTYG is one real-world fact, not something that can
  // genuinely differ class by class, but teacher_attendance is recorded
  // per (class_id, teacher_id, date) -- so without this, a co-teacher
  // marking someone absent in THIS class has no effect on their record in
  // any OTHER class they're also assigned to that same day, which either
  // silently stays at whatever default that class's own submission left
  // it at (Present, unless that teacher happened to mark themselves
  // Unavailable), or never gets a row at all if that class's attendance
  // was never submitted. cascadeAbsence below closes that gap by writing
  // Absent into every one of that teacher's OTHER classes for today too,
  // the moment this save marks them Absent in this one. Deliberately
  // one-directional -- saving someone as Present here never overwrites an
  // Absent already recorded elsewhere, since that could otherwise erase a
  // real, separately-confirmed absence without anyone deciding to.
  panel.querySelector('.save-review-btn').addEventListener('click', async () => {
    const studentStatuses = [...panel.querySelectorAll('.review-student-row')].map(row => ({
      recordId: row.dataset.recordId,
      status: row.querySelector('.toggle-btn.active')?.dataset.status || 'present'
    }))
    const teacherStatuses = [...panel.querySelectorAll('.review-teacher-row')].map(row => ({
      recordId: row.dataset.recordId,
      teacherId: row.dataset.teacherId,
      name: toTitleCase(row.querySelector('span')?.textContent),
      status: row.querySelector('.toggle-btn.active')?.dataset.status || 'present'
    }))
    const updates = [
      ...studentStatuses.map(({ recordId, status }) => supabase.from('attendance').update({ status }).eq('id', recordId)),
      ...teacherStatuses.map(({ recordId, status }) => supabase.from('teacher_attendance').update({ status }).eq('id', recordId))
    ]
    const results = await Promise.all(updates)
    if (results.some(r => r.error)) {
      showReviewMessage(ADMIN_MESSAGES.today.reviewSaveError, 'error')
      return
    }

    showReviewMessage(ADMIN_MESSAGES.today.reviewSaved, 'success')
    // Audited after the write succeeds, not before -- see audit.js.
    // One row for the whole save (not one per student/teacher row) since
    // this is a single decision the admin made, even though it touches
    // several rows at once.
    const presentCount = [...studentStatuses, ...teacherStatuses].filter(s => s.status === 'present').length
    const absentCount = [...studentStatuses, ...teacherStatuses].filter(s => s.status === 'absent').length
    logAudit(
      userId, 'admin', 'attendance.reviewed_saved', 'attendance', classId,
      `Saved ${className} attendance for ${today} (${presentCount} present, ${absentCount} absent)`,
      { class_id: classId, date: today, student_count: studentStatuses.length, teacher_count: teacherStatuses.length }
    )

    // Cascade: for every teacher just saved as Absent here, mirror that
    // into their teacher_attendance row (creating it if it doesn't exist
    // yet) for every OTHER class they're linked to, for this same date.
    // Wrapped in try/catch (unlike a plain per-call .error check) because
    // a dropped connection throws outright instead of resolving with an
    // error object (same caveat as openClassReviewModal's own fetch,
    // above) -- without this, that throw would skip the read-only lockdown
    // right below and leave the modal looking editable even though the
    // actual save already succeeded.
    try {
      const absentTeachers = teacherStatuses.filter(t => t.status === 'absent' && t.teacherId)
      const cascadeSummaries = []
      for (const t of absentTeachers) {
        const { data: otherLinks, error: linksError } = await supabase
          .from('class_teachers')
          .select('class_id, classes(name)')
          .eq('teacher_id', t.teacherId)
          .neq('class_id', classId)
        if (linksError || !otherLinks || otherLinks.length === 0) continue

        const { error: cascadeError } = await supabase
          .from('teacher_attendance')
          .upsert(
            otherLinks.map(link => ({
              class_id: link.class_id, teacher_id: t.teacherId, date: today,
              status: 'absent', marked_by: userId
            })),
            { onConflict: 'class_id,teacher_id,date' }
          )
        if (cascadeError) {
          console.error('Error cascading absence to other classes:', cascadeError)
          continue
        }
        const otherClassNames = otherLinks.map(link => link.classes?.name).filter(Boolean)
        cascadeSummaries.push({ name: t.name, classNames: otherClassNames })
      }
      if (cascadeSummaries.length > 0) {
        const detail = cascadeSummaries.map(c => `${c.name} (${c.classNames.join(', ')})`).join('; ')
        showToast(ADMIN_MESSAGES.today.absenceCascaded(cascadeSummaries))
        logAudit(
          userId, 'admin', 'teacher_attendance.absence_cascaded', 'teacher_attendance', classId,
          `Marked absent everywhere today, from ${className}: ${detail}`,
          { class_id: classId, date: today, cascaded: cascadeSummaries }
        )
      }
    } catch (err) {
      console.error('Error cascading absence to other classes:', err)
    }

    // Once saved, this review is done -- disable both actions so a
    // stray extra click can't re-save what's already saved, or reject a
    // submission the admin just finished accepting in the same breath.
    // Toggles disable too, since they'd otherwise still look editable
    // with no way left on screen to persist a further change -- closing
    // and reopening the modal (which fetches fresh data) is how to make
    // another pass after this.
    panel.querySelector('.save-review-btn').disabled = true
    panel.querySelector('.reject-review-btn').disabled = true
    panel.querySelectorAll('.toggle-btn').forEach(btn => { btn.disabled = true })
    panel.querySelectorAll('.review-student-row, .review-teacher-row').forEach(row => row.classList.add('read-only'))
  })

  // Reject for rework: flags today's records for this class as
  // needs_rework rather than deleting them (see
  // data_import/22_attendance_rework_flag.sql), so the teacher's original
  // submission is preserved -- their "Take Attendance" tab reopens
  // pre-filled with exactly what they submitted, and they only have to
  // change whatever the admin actually flagged, not redo the whole thing.
  // Two-click confirm instead of a native confirm() dialog (this app
  // doesn't use those anywhere) -- first click arms it, second actually
  // sets the flag; a stray single click can't send it back by accident.
  const rejectBtn = panel.querySelector('.reject-review-btn')
  let rejectArmed = false
  rejectBtn.addEventListener('click', async () => {
    if (!rejectArmed) {
      rejectArmed = true
      rejectBtn.textContent = ADMIN_MESSAGES.today.rejectConfirmLabel
      rejectBtn.classList.add('confirm-armed')
      return
    }

    // Flags class_lesson_notes for this class+day too (if a row exists --
    // .update() simply matches zero rows and succeeds when it doesn't), so
    // the lesson-note textarea reopens for editing at the same time as
    // attendance itself (see data_import/30_class_lesson_notes.sql).
    const [{ error: studentError }, { error: teacherError }] = await Promise.all([
      supabase.from('attendance').update({ needs_rework: true }).eq('class_id', classId).eq('date', today),
      supabase.from('teacher_attendance').update({ needs_rework: true }).eq('class_id', classId).eq('date', today),
      supabase.from('class_lesson_notes').update({ needs_rework: true }).eq('class_id', classId).eq('date', today)
    ])

    if (studentError || teacherError) {
      showReviewMessage(ADMIN_MESSAGES.today.rejectError, 'error')
      rejectArmed = false
      rejectBtn.textContent = ADMIN_MESSAGES.today.rejectLabel
      rejectBtn.classList.remove('confirm-armed')
      return
    }

    showToast(ADMIN_MESSAGES.today.rejectedForRework)
    logAudit(
      userId, 'admin', 'attendance.rejected_for_rework', 'attendance', classId,
      `Rejected ${className} attendance for rework (${today})`,
      { class_id: classId, date: today }
    )
    // The modal is appended straight to <body> (see openClassReviewModal),
    // not nested inside the Today tab's own markup, so re-rendering the
    // tab doesn't remove it on its own -- close it explicitly before
    // refreshing the board behind it.
    closeClassReviewModal()
    renderTodayTab(userId)
  })
}

/**
 * Opens the "Backfill Attendance" modal for one class + past date (see
 * renderRecordsTab's "+ Backfill Attendance" panel and wireBackfillPanel
 * above, which is the only caller). Visually reuses the Today tab's
 * review-modal CSS (.review-modal-overlay/.review-modal/.review-list/etc
 * -- see openClassReviewModal) for consistency, but is otherwise a
 * separate implementation with one key difference: openClassReviewModal
 * only ever shows rows for attendance records that already exist, because
 * every date it's used for (always today) already has at least one row by
 * the time it's opened. This modal exists specifically for a date that
 * might have NO rows at all -- a teacher who never submitted -- so its
 * rows are built from the class's actual current roster (every student
 * plus every assigned teacher), pre-filled from whatever attendance rows
 * for that date DO already exist and defaulting the rest to Present, same
 * convention as a teacher's own fresh "Take Attendance" form. Saving then
 * inserts a fresh row for anyone with no existing record and updates the
 * rest in place, exactly like teacher.js's renderAttendanceForm's own
 * insert-or-update split (see its doc comment) -- the same silent-no-op
 * risk a blind `.update().eq('id', undefined)` would have here otherwise.
 *
 * @param {string} classId
 * @param {string} className
 * @param {string} date - 'YYYY-MM-DD', never in the future (see
 *   wireBackfillPanel's guard).
 * @param {string} userId - Signed-in admin's id, recorded as `marked_by`
 *   on every row this inserts, and as the actor on the audit_log entry a
 *   save here writes.
 */
async function openBackfillModal(classId, className, date, userId) {
  closeBackfillModal()

  let students, coTeachers, existingStudentRecords, existingTeacherRecords
  try {
    // Optional classes (Gita/Bhajan) get their roster from
    // students.optional_class rather than students.class_id -- same
    // reasoning and same lookup as teacher.js's renderTeacherDashboard
    // (see OPTIONAL_CLASS_CODE_BY_NAME's own doc comment in format.js).
    const optionalCode = OPTIONAL_CLASS_CODE_BY_NAME[className]
    const [classRes, studentsRes, studentRecordsRes, teacherRecordsRes] = await Promise.all([
      supabase.from('classes').select('class_teachers(teacher_id, profiles(full_name))').eq('id', classId).single(),
      optionalCode
        ? supabase.from('students').select('id, full_name').eq('optional_class', optionalCode)
        : supabase.from('students').select('id, full_name').eq('class_id', classId),
      supabase.from('attendance').select('id, student_id, status').eq('class_id', classId).eq('date', date),
      supabase.from('teacher_attendance').select('id, teacher_id, status').eq('class_id', classId).eq('date', date)
    ])
    if (classRes.error || studentsRes.error || studentRecordsRes.error || teacherRecordsRes.error) {
      throw (classRes.error || studentsRes.error || studentRecordsRes.error || teacherRecordsRes.error)
    }
    coTeachers = classRes.data?.class_teachers || []
    students = studentsRes.data || []
    existingStudentRecords = studentRecordsRes.data || []
    existingTeacherRecords = teacherRecordsRes.data || []
  } catch (err) {
    console.error('Error loading roster for backfill:', err)
    showToast(ADMIN_MESSAGES.records.backfill.errorLoadingRoster(err))
    return
  }

  const studentRecordByStudentId = new Map(existingStudentRecords.map(r => [r.student_id, r]))
  const teacherRecordByTeacherId = new Map(existingTeacherRecords.map(r => [r.teacher_id, r]))

  // Same row markup/classes as openClassReviewModal's buildReviewRow, plus
  // a second data attribute (data-existing-id, possibly empty) so the
  // save handler below knows whether to insert or update this particular
  // row -- buildReviewRow's single data-record-id doesn't distinguish
  // those since it's never called for a row with no record to begin with.
  const buildRow = (rowClass, entityId, existingRecord, name) => {
    const status = existingRecord?.status || 'present'
    return `
    <div class="${rowClass}" data-entity-id="${entityId}" data-existing-id="${existingRecord?.id || ''}">
      <span>${name}</span>
      <div class="status-toggle">
        <button class="toggle-btn present-btn${status === 'present' ? ' active' : ''}" data-status="present">Present</button>
        <button class="toggle-btn absent-btn${status === 'absent' ? ' active' : ''}" data-status="absent">Absent</button>
      </div>
    </div>
  `
  }

  const studentRows = [...students]
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    .map(s => buildRow('review-student-row', s.id, studentRecordByStudentId.get(s.id), toTitleCase(s.full_name)))
    .join('')

  const teacherRows = [...coTeachers]
    .sort((a, b) => (a.profiles?.full_name || '').localeCompare(b.profiles?.full_name || ''))
    .map(ct => buildRow('review-teacher-row', ct.teacher_id, teacherRecordByTeacherId.get(ct.teacher_id), toTitleCase(ct.profiles?.full_name) || 'Teacher'))
    .join('')

  const noRosterHtml = `<p>${ADMIN_MESSAGES.records.backfill.noRosterForClass}</p>`

  const overlay = document.createElement('div')
  overlay.id = 'backfill-modal-overlay'
  overlay.className = 'review-modal-overlay'
  overlay.innerHTML = `
    <div class="review-modal" id="backfill-modal">
      <button class="review-modal-close" aria-label="Close">&times;</button>
      <h4>${className} — ${date}</h4>
      ${studentRows ? `<h5>${ADMIN_MESSAGES.today.reviewStudentsHeading}</h5><div class="review-list">${studentRows}</div>` : ''}
      ${teacherRows ? `<h5>${ADMIN_MESSAGES.today.reviewTeachersHeading}</h5><div class="review-list">${teacherRows}</div>` : ''}
      ${!studentRows && !teacherRows ? noRosterHtml : ''}
      ${studentRows || teacherRows ? `
        <div class="review-actions">
          <button class="save-review-btn">${ADMIN_MESSAGES.records.backfill.saveButtonLabel}</button>
        </div>
      ` : ''}
      <p class="review-message hidden"></p>
    </div>
  `
  document.body.appendChild(overlay)

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeBackfillModal()
  })
  overlay.querySelector('.review-modal-close').addEventListener('click', closeBackfillModal)
  document.addEventListener('keydown', escKeyClosesBackfillModal)

  wireBackfillModalSave(overlay.querySelector('.review-modal'), classId, className, date, userId)
}

/** Removes the Backfill Attendance modal from the page, if one is open. */
function closeBackfillModal() {
  document.getElementById('backfill-modal-overlay')?.remove()
  document.removeEventListener('keydown', escKeyClosesBackfillModal)
}

/** Escape-key handler for the Backfill Attendance modal -- see openBackfillModal. */
function escKeyClosesBackfillModal(e) {
  if (e.key === 'Escape') closeBackfillModal()
}

/**
 * Wires up an open Backfill Attendance modal's toggle buttons and its
 * single "Save Attendance" action -- insert-or-update per row (see
 * openBackfillModal's doc comment for why), then refreshes the Records
 * tab's currently-loaded range behind it so the newly entered day shows
 * up immediately if it falls within it. Also cascades any teacher
 * backfilled as Absent here to their other classes on this same date,
 * same as the Today tab's wireReviewPanel -- see the cascade block below
 * for the full reasoning.
 *
 * @param {HTMLElement} panel - The #backfill-modal element.
 * @param {string} classId
 * @param {string} className
 * @param {string} date - 'YYYY-MM-DD'
 * @param {string} userId
 */
function wireBackfillModalSave(panel, classId, className, date, userId) {
  panel.querySelectorAll('.review-student-row, .review-teacher-row').forEach(row => {
    row.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })
  })

  const msg = panel.querySelector('.review-message')
  const showReviewMessage = (text, kind) => {
    msg.textContent = text
    msg.className = `review-message ${kind}`
    msg.classList.remove('hidden')
  }

  const saveBtn = panel.querySelector('.save-review-btn')
  if (!saveBtn) return // No roster at all -- nothing to wire (see openBackfillModal's noRosterHtml branch).

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true

    const buildWrites = (rowSelector, table, idColumn) =>
      [...panel.querySelectorAll(rowSelector)].map(row => {
        const status = row.querySelector('.toggle-btn.active')?.dataset.status || 'present'
        const existingId = row.dataset.existingId
        return existingId
          ? supabase.from(table).update({ status }).eq('id', existingId)
          : supabase.from(table).insert({ [idColumn]: row.dataset.entityId, class_id: classId, date, status, marked_by: userId })
      })

    const writes = [
      ...buildWrites('.review-student-row', 'attendance', 'student_id'),
      ...buildWrites('.review-teacher-row', 'teacher_attendance', 'teacher_id')
    ]
    const results = await Promise.all(writes)

    if (results.some(r => r.error)) {
      showReviewMessage(ADMIN_MESSAGES.records.backfill.saveError, 'error')
      saveBtn.disabled = false
      return
    }

    showReviewMessage(ADMIN_MESSAGES.records.backfill.saved, 'success')
    const presentCount = [...panel.querySelectorAll('.toggle-btn.active[data-status="present"]')].length
    const absentCount = [...panel.querySelectorAll('.toggle-btn.active[data-status="absent"]')].length
    logAudit(
      userId, 'admin', 'attendance.backfilled', 'attendance', classId,
      `Backfilled ${className} attendance for ${date} (${presentCount} present, ${absentCount} absent)`,
      { class_id: classId, date }
    )

    // Same cascade as the Today tab's review modal (see wireReviewPanel's
    // own doc comment for the full reasoning) -- a teacher backfilled as
    // Absent here for one class was just as physically absent from their
    // other classes that same day, so this writes Absent into
    // teacher_attendance for each of those too, rather than leaving this
    // one class as the only record of it. Same one-directional rule:
    // backfilling someone as Present never overwrites an Absent already
    // recorded elsewhere for that date. Wrapped in try/catch, same reason
    // as wireReviewPanel's -- a dropped connection throws rather than
    // resolving with an error object, and that throw would otherwise skip
    // the Records-tab refresh and modal auto-close below even though the
    // actual backfill save already succeeded.
    try {
      const absentTeachers = [...panel.querySelectorAll('.review-teacher-row')]
        .map(row => ({
          teacherId: row.dataset.entityId,
          name: toTitleCase(row.querySelector('span')?.textContent),
          status: row.querySelector('.toggle-btn.active')?.dataset.status || 'present'
        }))
        .filter(t => t.status === 'absent' && t.teacherId)

      const cascadeSummaries = []
      for (const t of absentTeachers) {
        const { data: otherLinks, error: linksError } = await supabase
          .from('class_teachers')
          .select('class_id, classes(name)')
          .eq('teacher_id', t.teacherId)
          .neq('class_id', classId)
        if (linksError || !otherLinks || otherLinks.length === 0) continue

        const { error: cascadeError } = await supabase
          .from('teacher_attendance')
          .upsert(
            otherLinks.map(link => ({
              class_id: link.class_id, teacher_id: t.teacherId, date,
              status: 'absent', marked_by: userId
            })),
            { onConflict: 'class_id,teacher_id,date' }
          )
        if (cascadeError) {
          console.error('Error cascading backfilled absence to other classes:', cascadeError)
          continue
        }
        const otherClassNames = otherLinks.map(link => link.classes?.name).filter(Boolean)
        cascadeSummaries.push({ name: t.name, classNames: otherClassNames })
      }
      if (cascadeSummaries.length > 0) {
        const detail = cascadeSummaries.map(c => `${c.name} (${c.classNames.join(', ')})`).join('; ')
        showToast(ADMIN_MESSAGES.records.backfill.absenceCascaded(cascadeSummaries, date))
        logAudit(
          userId, 'admin', 'teacher_attendance.absence_cascaded', 'teacher_attendance', classId,
          `Backfilled absent everywhere for ${date}, from ${className}: ${detail}`,
          { class_id: classId, date, cascaded: cascadeSummaries }
        )
      }
    } catch (err) {
      console.error('Error cascading backfilled absence to other classes:', err)
    }

    // Re-fetch this same date's range if it's currently loaded on the
    // Records tab behind the modal, so the entry just saved shows up
    // without the admin needing to hit Filter again themselves.
    const startDate = document.getElementById('start-date')?.value
    const endDate = document.getElementById('end-date')?.value
    if (startDate && endDate && date >= startDate && date <= endDate) {
      loadRecordsRange(startDate, endDate)
      loadTeacherAttendanceRange(startDate, endDate)
    }

    setTimeout(closeBackfillModal, 1200)
  })
}

/**
 * "Class Groups" tab: lets an admin split any class into any number of
 * named groups (see data_import/85_class_groups_generalized.sql's
 * class_groups table, which replaced file 84's narrow, Bhajan-only,
 * hardcoded-to-two-values students.attendance_group column) and assign
 * students into them. A class with no groups defined here is completely
 * unaffected everywhere else in the app -- students.class_group_id being
 * null for its whole roster is exactly the same as before this feature
 * existed. Once a class has at least one group, its assigned teacher(s)
 * see a group picker instead of one shared roster on the Take Attendance
 * tab (see teacher.js's renderGroupPicker), and each group's submission is
 * tracked independently.
 *
 * Deliberately picks a class first rather than showing every class's
 * groups at once -- most classes will never have any, so a flat list of
 * every class up front would mostly be empty noise.
 *
 * @param {string} userId - Signed-in admin's id, attributed on every
 *   group create/rename/delete and student (re)assignment via audit.js.
 */
async function renderClassGroupsTab(userId) {
  const tabContent = document.getElementById('tab-content')

  // Same grade-order-first sort as the Backfill panel's class dropdown
  // (see wireBackfillPanel) -- Gita/Bhajan/volunteer teams land after
  // every grade rather than wherever alphabetical order happens to put
  // them.
  const { data: classes } = await supabase.from('classes').select('id, name').order('name')
  const sortedClasses = [...(classes || [])].sort((a, b) => {
    const rankA = GRADE_ORDER.indexOf(a.name)
    const rankB = GRADE_ORDER.indexOf(b.name)
    const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
    const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })

  tabContent.innerHTML = `
    <p class="drag-hint">${ADMIN_MESSAGES.classGroups.hint}</p>
    <div class="date-range">
      <label>${ADMIN_MESSAGES.classGroups.classLabel}:
        <select id="class-groups-select">
          <option value="">${ADMIN_MESSAGES.classGroups.classPlaceholder}</option>
          ${sortedClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </label>
    </div>
    <div id="class-groups-detail"></div>
  `

  document.getElementById('class-groups-select').addEventListener('change', (e) => {
    const classId = e.target.value
    const detail = document.getElementById('class-groups-detail')
    if (!classId) {
      detail.innerHTML = ''
      return
    }
    const className = e.target.options[e.target.selectedIndex].text
    loadClassGroupsDetail(classId, className, userId)
  })
}

/**
 * Fetches and renders one class's groups (with rename/delete) plus its
 * full student roster (with a per-student group dropdown) into
 * #class-groups-detail -- the only content that changes when the class
 * dropdown above it changes, or after any create/rename/delete/reassign
 * below succeeds (each of those calls this again rather than patching the
 * DOM piecemeal, since a group's own list and every dropdown's option list
 * both need to stay in sync with each other).
 *
 * @param {string} classId
 * @param {string} className
 * @param {string} userId
 */
async function loadClassGroupsDetail(classId, className, userId) {
  const detail = document.getElementById('class-groups-detail')
  detail.innerHTML = `<p>${ADMIN_MESSAGES.records.backfill.loadingRoster}</p>`

  let groups, students
  try {
    // Optional classes (Gita/Bhajan) get their roster from
    // students.optional_class rather than students.class_id -- same
    // lookup teacher.js's renderTeacherDashboard and admin.js's
    // openBackfillModal both already use (see OPTIONAL_CLASS_CODE_BY_NAME's
    // own doc comment in format.js).
    const optionalCode = OPTIONAL_CLASS_CODE_BY_NAME[className]
    const [groupsRes, studentsRes] = await Promise.all([
      supabase.from('class_groups').select('id, name').eq('class_id', classId).order('name'),
      optionalCode
        ? supabase.from('students').select('id, full_name, class_group_id').eq('optional_class', optionalCode)
        : supabase.from('students').select('id, full_name, class_group_id').eq('class_id', classId)
    ])
    if (groupsRes.error || studentsRes.error) throw (groupsRes.error || studentsRes.error)
    groups = groupsRes.data || []
    students = studentsRes.data || []
  } catch (err) {
    detail.innerHTML = `<p class="error">${ADMIN_MESSAGES.classGroups.loadError(err)}</p>`
    return
  }

  const groupOptionsHtml = (selectedId) => `
    <option value=""${!selectedId ? ' selected' : ''}>${ADMIN_MESSAGES.classGroups.ungroupedOption}</option>
    ${groups.map(g => `<option value="${g.id}"${g.id === selectedId ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
  `

  const groupRowsHtml = groups.map(g => `
    <div class="class-group-row" data-group-id="${g.id}">
      <span class="class-group-name">${escapeHtml(g.name)}</span>
      <div class="class-group-row-actions">
        <button type="button" class="class-group-rename-btn">${ADMIN_MESSAGES.classGroups.renameButton}</button>
        <button type="button" class="class-group-delete-btn">${ADMIN_MESSAGES.classGroups.deleteButton}</button>
      </div>
    </div>
  `).join('')

  const studentRowsHtml = [...students]
    .sort((a, b) => (a.full_name || '').localeCompare(b.full_name || ''))
    .map(s => `
      <div class="class-group-student-row" data-student-id="${s.id}">
        <span>${toTitleCase(s.full_name)}</span>
        <select class="class-group-student-select">${groupOptionsHtml(s.class_group_id)}</select>
      </div>
    `).join('')

  detail.innerHTML = `
    <h4>${className} — ${ADMIN_MESSAGES.classGroups.groupsHeading}</h4>
    <div id="class-group-list">${groupRowsHtml || `<p>${ADMIN_MESSAGES.classGroups.noGroupsYet}</p>`}</div>
    <div class="class-group-add-row">
      <input type="text" id="class-group-add-input" placeholder="${ADMIN_MESSAGES.classGroups.addGroupPlaceholder}" />
      <button type="button" id="class-group-add-btn">${ADMIN_MESSAGES.classGroups.addGroupButton}</button>
    </div>
    <p id="class-group-message" class="hidden"></p>
    ${students.length > 0 ? `
      <h4>${ADMIN_MESSAGES.classGroups.rosterHeading}</h4>
      <p class="drag-hint">${ADMIN_MESSAGES.classGroups.rosterHint}</p>
      <div id="class-group-roster">${studentRowsHtml}</div>
    ` : `<p>${ADMIN_MESSAGES.classGroups.noStudentsInClass}</p>`}
  `

  wireClassGroupsDetail(detail, classId, className, userId)
}

/**
 * Wires everything loadClassGroupsDetail just rendered: add/rename/delete
 * on the groups list, and the per-student group dropdown. Every write
 * here re-fetches and re-renders the whole detail panel via
 * loadClassGroupsDetail on success, rather than patching the DOM in
 * place -- a class's group list is short enough (a handful of groups at
 * most) that this stays cheap, and it guarantees every dropdown's option
 * list is always exactly in sync with the group list above it, including
 * right after a group was just added, renamed, or deleted.
 *
 * @param {HTMLElement} detail - The #class-groups-detail element.
 * @param {string} classId
 * @param {string} className
 * @param {string} userId
 */
function wireClassGroupsDetail(detail, classId, className, userId) {
  const msg = detail.querySelector('#class-group-message')
  const showMsg = (text, kind) => {
    if (!msg) return
    msg.textContent = text
    msg.className = kind
    msg.classList.remove('hidden')
  }

  // --- Add a group -----------------------------------------------------
  const addBtn = detail.querySelector('#class-group-add-btn')
  const addInput = detail.querySelector('#class-group-add-input')
  addBtn?.addEventListener('click', async () => {
    const name = addInput.value.trim()
    if (!name) {
      showMsg(ADMIN_MESSAGES.classGroups.addGroupNameRequired, 'error')
      return
    }
    addBtn.disabled = true
    const { error } = await supabase.from('class_groups').insert({ class_id: classId, name })
    addBtn.disabled = false
    if (error) {
      // Postgres' unique_violation code, from this table's unique(class_id,
      // name) constraint (see data_import/85_class_groups_generalized.sql)
      // -- a friendlier message than the raw constraint-violation text.
      showMsg(error.code === '23505' ? ADMIN_MESSAGES.classGroups.addGroupDuplicate : ADMIN_MESSAGES.classGroups.addGroupError(error), 'error')
      return
    }
    showToast(ADMIN_MESSAGES.classGroups.groupAdded(name))
    logAudit(
      userId, 'admin', 'class_group.created', 'class_groups', classId,
      `Added group "${name}" to ${className}`,
      { class_id: classId, name }
    )
    loadClassGroupsDetail(classId, className, userId)
  })

  // --- Rename a group ----------------------------------------------------
  detail.querySelectorAll('.class-group-rename-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.closest('.class-group-row')
      const groupId = row.dataset.groupId
      const nameSpan = row.querySelector('.class-group-name')
      const currentName = nameSpan.textContent
      row.querySelector('.class-group-row-actions').innerHTML = ''
      nameSpan.outerHTML = `
        <input type="text" class="class-group-rename-input" value="${escapeHtml(currentName)}" />
        <button type="button" class="class-group-rename-save-btn">${ADMIN_MESSAGES.classGroups.renameSaveButton}</button>
        <button type="button" class="class-group-rename-cancel-btn">${ADMIN_MESSAGES.classGroups.renameCancelButton}</button>
      `
      row.querySelector('.class-group-rename-cancel-btn').addEventListener('click', () => {
        loadClassGroupsDetail(classId, className, userId)
      })
      row.querySelector('.class-group-rename-save-btn').addEventListener('click', async () => {
        const newName = row.querySelector('.class-group-rename-input').value.trim()
        if (!newName) {
          showMsg(ADMIN_MESSAGES.classGroups.renameNameRequired, 'error')
          return
        }
        const { error } = await supabase.from('class_groups').update({ name: newName }).eq('id', groupId)
        if (error) {
          showMsg(error.code === '23505' ? ADMIN_MESSAGES.classGroups.addGroupDuplicate : ADMIN_MESSAGES.classGroups.renameError(error), 'error')
          return
        }
        showToast(ADMIN_MESSAGES.classGroups.renamed)
        logAudit(
          userId, 'admin', 'class_group.renamed', 'class_groups', classId,
          `Renamed a ${className} group "${currentName}" -> "${newName}"`,
          { class_id: classId, group_id: groupId, old_name: currentName, new_name: newName }
        )
        loadClassGroupsDetail(classId, className, userId)
      })
    })
  })

  // --- Delete a group ------------------------------------------------
  // Two-click confirm instead of a native confirm() dialog -- same pattern
  // as the Today tab's "Reject for rework" button (see
  // openClassReviewModal's own doc comment): first click arms it, second
  // actually deletes, so a stray single click can't remove a group by
  // accident. Deleting a group never deletes its students -- the
  // class_group_id foreign key is ON DELETE SET NULL (see
  // data_import/85_class_groups_generalized.sql), so they're simply
  // ungrouped again, same as before that group ever existed.
  detail.querySelectorAll('.class-group-delete-btn').forEach(btn => {
    let armed = false
    btn.addEventListener('click', async () => {
      const row = btn.closest('.class-group-row')
      const groupId = row.dataset.groupId
      const groupName = row.querySelector('.class-group-name').textContent
      if (!armed) {
        armed = true
        btn.textContent = ADMIN_MESSAGES.classGroups.deleteConfirmButton
        btn.classList.add('confirm-armed')
        return
      }
      btn.disabled = true
      const { error } = await supabase.from('class_groups').delete().eq('id', groupId)
      if (error) {
        showMsg(ADMIN_MESSAGES.classGroups.deleteError(error), 'error')
        btn.disabled = false
        armed = false
        btn.textContent = ADMIN_MESSAGES.classGroups.deleteButton
        btn.classList.remove('confirm-armed')
        return
      }
      showToast(ADMIN_MESSAGES.classGroups.deleted(groupName))
      logAudit(
        userId, 'admin', 'class_group.deleted', 'class_groups', classId,
        `Deleted group "${groupName}" from ${className}`,
        { class_id: classId, group_id: groupId, name: groupName }
      )
      loadClassGroupsDetail(classId, className, userId)
    })
  })

  // --- Assign a student to a group ------------------------------------
  // Saves immediately on change, same "no separate submit step" pattern as
  // the teacher Calendar tab's Available/Unavailable toggle -- optimistic
  // isn't needed here since a <select> already shows its own new value the
  // instant it's changed; only a failure needs to revert it, back to
  // whatever this row's original selection was.
  detail.querySelectorAll('.class-group-student-select').forEach(select => {
    const originalValue = select.value
    select.addEventListener('change', async () => {
      const row = select.closest('.class-group-student-row')
      const studentId = row.dataset.studentId
      const studentName = row.querySelector('span').textContent
      const newGroupId = select.value || null
      select.disabled = true
      const { error } = await supabase.from('students').update({ class_group_id: newGroupId }).eq('id', studentId)
      select.disabled = false
      if (error) {
        showMsg(ADMIN_MESSAGES.classGroups.assignmentError(error), 'error')
        select.value = originalValue
        return
      }
      showToast(ADMIN_MESSAGES.classGroups.assignmentSaved)
      // Read the chosen option's own text rather than looking the id back
      // up in a `groups` array -- this function doesn't have that array in
      // scope, and the visible option text is exactly the name that was
      // just picked either way.
      const newGroupName = select.options[select.selectedIndex].text
      logAudit(
        userId, 'admin', 'class_group.student_assigned', 'students', studentId,
        `Assigned ${toTitleCase(studentName)} to ${newGroupName} in ${className}`,
        { class_id: classId, student_id: studentId, class_group_id: newGroupId }
      )
    })
  })
}

const KUDOS_LEADERBOARD_TOP_N = 10

/**
 * "Kudos" tab: a read-only admin mirror of the teacher-facing
 * Kudos tab (see teacher.js's renderKudosTab and data_import/
 * 86_recognition_categories_and_points.sql, renamed to the kudos_* tables
 * by data_import/88_rename_recognition_to_kudos.sql) -- admins can see every
 * class's categories, leaderboards and full award history, but never
 * create/edit/delete anything here (that stays teacher-only, same as the
 * Smile Box wall's read-only admin mirror under Records). No userId/audit
 * logging needed since this tab never writes anything.
 */
async function renderKudosTab() {
  const tabContent = document.getElementById('tab-content')
  const messages = ADMIN_MESSAGES.kudos

  const { data: classes } = await supabase.from('classes').select('id, name').order('name')
  const sortedClasses = [...(classes || [])].sort((a, b) => {
    const rankA = GRADE_ORDER.indexOf(a.name)
    const rankB = GRADE_ORDER.indexOf(b.name)
    const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
    const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })

  tabContent.innerHTML = `
    <p class="drag-hint">${messages.hint}</p>
    <div class="date-range">
      <label>${messages.classLabel}:
        <select id="kudos-admin-class-select">
          <option value="">${messages.classPlaceholder}</option>
          ${sortedClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
      </label>
    </div>
    <div id="kudos-admin-detail"></div>
  `

  document.getElementById('kudos-admin-class-select').addEventListener('change', (e) => {
    const classId = e.target.value
    const detail = document.getElementById('kudos-admin-detail')
    if (!classId) {
      detail.innerHTML = ''
      return
    }
    const className = e.target.options[e.target.selectedIndex].text
    loadKudosAdminDetail(classId, className)
  })
}

/**
 * Fetches and renders one class's kudos categories, plus whichever
 * leaderboard (Overall, or one category) is currently selected, and the
 * full award history -- all read-only. Category pills switch the
 * selection with a pure re-render (no refetch), same as the teacher-side
 * tab this mirrors.
 *
 * @param {string} classId
 * @param {string} className
 * @param {string|null} [selectedCategoryId] - null means "Overall".
 */
async function loadKudosAdminDetail(classId, className, selectedCategoryId = null) {
  const detail = document.getElementById('kudos-admin-detail')
  const messages = ADMIN_MESSAGES.kudos
  detail.innerHTML = `<p>${ADMIN_MESSAGES.records.backfill.loadingRoster}</p>`

  let categories, points, students, teachers
  try {
    // Optional classes (Gita/Bhajan) get their roster from
    // students.optional_class rather than students.class_id -- same
    // lookup loadClassGroupsDetail above and teacher.js's
    // renderTeacherDashboard both already use (see
    // OPTIONAL_CLASS_CODE_BY_NAME's own doc comment in format.js).
    const optionalCode = OPTIONAL_CLASS_CODE_BY_NAME[className]
    const [categoriesRes, pointsRes, studentsRes] = await Promise.all([
      supabase.from('kudos_categories').select('id, name').eq('class_id', classId).order('name'),
      supabase.from('kudos_points').select('id, category_id, student_id, points, teacher_id, note, awarded_at').eq('class_id', classId).order('awarded_at', { ascending: false }),
      optionalCode
        ? supabase.from('students').select('id, full_name').eq('optional_class', optionalCode)
        : supabase.from('students').select('id, full_name').eq('class_id', classId)
    ])
    if (categoriesRes.error || pointsRes.error || studentsRes.error) throw (categoriesRes.error || pointsRes.error || studentsRes.error)
    categories = categoriesRes.data || []
    points = pointsRes.data || []
    students = studentsRes.data || []

    const teacherIds = [...new Set(points.map(p => p.teacher_id))]
    const teachersRes = teacherIds.length > 0
      ? await supabase.from('profiles').select('id, full_name').in('id', teacherIds)
      : { data: [] }
    teachers = teachersRes.data || []
  } catch (err) {
    detail.innerHTML = `<p class="error">${messages.loadError(err)}</p>`
    return
  }

  const nameByStudentId = new Map(students.map(s => [s.id, toTitleCase(s.full_name)]))
  const teacherNameById = new Map(teachers.map(t => [t.id, toTitleCase(t.full_name)]))

  const validSelection = selectedCategoryId && categories.some(c => c.id === selectedCategoryId) ? selectedCategoryId : null
  const pointsInScope = validSelection ? points.filter(p => p.category_id === validSelection) : points

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
      <button type="button" class="kudos-pill${!validSelection ? ' active' : ''}" data-category-id="">${messages.overallLabel}</button>
      ${categories.map(c => `<button type="button" class="kudos-pill${c.id === validSelection ? ' active' : ''}" data-category-id="${c.id}">${escapeHtml(c.name)}</button>`).join('')}
    </div>
  `

  const selectedCategory = validSelection ? categories.find(c => c.id === validSelection) : null

  const logRowsHtml = pointsInScope.length > 0
    ? pointsInScope.map(p => {
        const categoryName = selectedCategory ? selectedCategory.name : (categories.find(c => c.id === p.category_id)?.name || '')
        return `
          <div class="kudos-award-row">
            <div class="kudos-award-main">
              <span class="kudos-award-name">${nameByStudentId.get(p.student_id) || 'Unknown'}</span>
              <span class="kudos-award-points">${messages.pointsStat(p.points)}</span>
              ${!selectedCategory ? `<span class="kudos-award-category">${escapeHtml(categoryName)}</span>` : ''}
              <span class="kudos-award-category">${messages.awardedBy(teacherNameById.get(p.teacher_id) || 'Unknown')}</span>
            </div>
            ${p.note ? `<div class="kudos-award-note">${escapeHtml(p.note)}</div>` : ''}
          </div>
        `
      }).join('')
    : `<p class="history-empty">${messages.noLogYet}</p>`

  detail.innerHTML = `
    <h4>${className}</h4>
    ${categories.length === 0 ? `<p>${messages.noCategoriesYet}</p>` : `
      ${pillsHtml}
      <div class="insights-card kudos-leaderboard-card">
        <h4>${selectedCategory ? escapeHtml(selectedCategory.name) : messages.overallLabel}</h4>
        ${leaderboardRowsHtml}
      </div>
      <h4>${messages.logHeading}</h4>
      <div>${logRowsHtml}</div>
    `}
  `

  detail.querySelectorAll('.kudos-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      loadKudosAdminDetail(classId, className, btn.dataset.categoryId || null)
    })
  })
}

/**
 * Calendar tab: the admin's own space to manage class_sessions (see
 * data_import/15_class_sessions.sql) -- every scheduled date, editable
 * in place (label, type, and an Attendance Open/Closed toggle), plus a
 * form to add a new date entirely. Split into "Upcoming" (shown open, so
 * it's what the admin sees first) and a collapsed "Past Dates" so months
 * of history don't bury what's coming up next. This is what makes
 * attendance dates editable beyond the pre-loaded 2026-27 calendar
 * (data_import/15b) -- the Today tab just reports today's status; this
 * tab is where it's actually managed.
 *
 * @param {string} userId - Signed-in admin's id -- threaded through to
 *   wireCalendarTab so every edit here is attributed in the audit trail
 *   (see audit.js).
 */
async function renderCalendarTab(userId) {
  const tabContent = document.getElementById('tab-content')
  const today = todayStr()

  const { data: sessions, error } = await supabase
    .from('class_sessions')
    .select('*')
    .order('session_date', { ascending: true })
  if (error) showToast(ADMIN_MESSAGES.calendar.couldntLoad(error))

  const allSessions = sessions || []
  const upcoming = allSessions.filter(s => s.session_date >= today)
  const past = allSessions.filter(s => s.session_date < today)

  const dayTypeOptions = [
    ['regular', 'Regular'],
    ['special_event', 'Special event'],
    ['holiday', 'Holiday']
  ]

  tabContent.innerHTML = `
    <p class="drag-hint">${ADMIN_MESSAGES.calendar.hint}</p>
    <h4>Upcoming</h4>
    <div class="session-list">${buildSessionRows(upcoming, today)}</div>
    ${past.length > 0 ? `
      <details class="past-sessions">
        <summary>Past Dates (${past.length})</summary>
        <div class="session-list">${buildSessionRows(past, today)}</div>
      </details>
    ` : ''}
    <h4>Add a Date</h4>
    <form id="add-session-form" class="add-session-form">
      <input type="date" id="new-session-date" required />
      <input type="text" id="new-session-label" placeholder="Label (e.g. Makeup class)" required />
      <select id="new-session-type">${dayTypeOptions.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
      <label class="add-session-open-label"><input type="checkbox" id="new-session-open" checked /> Attendance open</label>
      <button type="submit">+ Add Date</button>
    </form>
  `

  wireCalendarTab(tabContent, userId)
}

/**
 * Builds the row markup for a list of class_sessions rows -- shared by
 * the "Upcoming" and "Past Dates" sections of the Calendar tab.
 *
 * @param {object[]} sessions
 * @param {string} today - 'YYYY-MM-DD'
 * @returns {string} HTML.
 */
function buildSessionRows(sessions, today) {
  const dayTypeOptions = [
    ['regular', 'Regular'],
    ['special_event', 'Special event'],
    ['holiday', 'Holiday']
  ]

  return sessions
    .map(s => {
      const typeOptionsHtml = dayTypeOptions
        .map(([value, label]) => `<option value="${value}"${s.day_type === value ? ' selected' : ''}>${label}</option>`)
        .join('')
      return `
        <div class="session-row${s.session_date === today ? ' session-row-today' : ''}" data-session-id="${s.id}">
          <span class="session-date">${s.session_date}${s.session_date === today ? ' <em>(Today)</em>' : ''}</span>
          <input type="text" class="session-label-input" value="${s.label.replace(/"/g, '&quot;')}" data-session-id="${s.id}" data-session-date="${s.session_date}" />
          <select class="session-type-select" data-session-id="${s.id}" data-session-date="${s.session_date}">${typeOptionsHtml}</select>
          <button type="button" class="session-toggle-btn ${s.is_attendance_day ? 'session-open' : 'session-closed'}" data-session-id="${s.id}" data-session-date="${s.session_date}" data-current="${s.is_attendance_day}">
            ${s.is_attendance_day ? 'Attendance Open' : 'Attendance Closed'}
          </button>
        </div>
      `
    })
    .join('') || `<p class="no-sessions">${ADMIN_MESSAGES.calendar.noDatesInSection}</p>`
}

/**
 * Wires up everything on the Calendar tab: auto-saving label/type edits,
 * the open/closed toggle, and the add-date form. Called once per
 * renderCalendarTab() render, right after its HTML is inserted.
 *
 * @param {HTMLElement} tabContent
 * @param {string} userId - Signed-in admin's id, recorded as the actor on
 *   every audit_log row this tab's edits write (see audit.js).
 */
function wireCalendarTab(tabContent, userId) {
  tabContent.querySelectorAll('.session-label-input').forEach(input => {
    input.addEventListener('change', async () => {
      const { error } = await supabase
        .from('class_sessions')
        .update({ label: input.value })
        .eq('id', input.dataset.sessionId)
      showToast(error ? ADMIN_MESSAGES.calendar.couldntUpdateDate(error) : ADMIN_MESSAGES.calendar.dateUpdated)
      if (!error) {
        logAudit(
          userId, 'admin', 'class_session.label_updated', 'class_session', input.dataset.sessionId,
          `Changed ${input.dataset.sessionDate} label to "${input.value}"`,
          { session_id: input.dataset.sessionId, session_date: input.dataset.sessionDate, label: input.value }
        )
      }
    })
  })

  tabContent.querySelectorAll('.session-type-select').forEach(select => {
    select.addEventListener('change', async () => {
      const { error } = await supabase
        .from('class_sessions')
        .update({ day_type: select.value })
        .eq('id', select.dataset.sessionId)
      showToast(error ? ADMIN_MESSAGES.calendar.couldntUpdateDate(error) : ADMIN_MESSAGES.calendar.dateUpdated)
      if (!error) {
        logAudit(
          userId, 'admin', 'class_session.day_type_updated', 'class_session', select.dataset.sessionId,
          `Changed ${select.dataset.sessionDate} type to "${select.options[select.selectedIndex].text}"`,
          { session_id: select.dataset.sessionId, session_date: select.dataset.sessionDate, day_type: select.value }
        )
      }
    })
  })

  tabContent.querySelectorAll('.session-toggle-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const opening = btn.dataset.current !== 'true'
      const { error } = await supabase
        .from('class_sessions')
        .update({ is_attendance_day: opening })
        .eq('id', btn.dataset.sessionId)
      if (error) {
        showToast(ADMIN_MESSAGES.calendar.couldntUpdateDate(error))
      } else {
        showToast(opening ? ADMIN_MESSAGES.calendar.attendanceOpenedForDate : ADMIN_MESSAGES.calendar.attendanceClosedForDate)
        logAudit(
          userId, 'admin', 'class_session.attendance_toggled', 'class_session', btn.dataset.sessionId,
          `${opening ? 'Opened' : 'Closed'} attendance for ${btn.dataset.sessionDate}`,
          { session_id: btn.dataset.sessionId, session_date: btn.dataset.sessionDate, is_attendance_day: opening }
        )
        renderCalendarTab(userId)
      }
    })
  })

  document.getElementById('add-session-form')?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const session_date = document.getElementById('new-session-date').value
    const label = document.getElementById('new-session-label').value
    const day_type = document.getElementById('new-session-type').value
    const is_attendance_day = document.getElementById('new-session-open').checked

    // upsert (not insert) since session_date is unique -- adding a date
    // that's already on the calendar just edits it in place instead of
    // erroring out.
    const { error } = await supabase
      .from('class_sessions')
      .upsert({ session_date, label, day_type, is_attendance_day }, { onConflict: 'session_date' })
    showToast(error ? ADMIN_MESSAGES.calendar.couldntAddDate(error) : ADMIN_MESSAGES.calendar.dateAdded)
    if (!error) {
      logAudit(
        userId, 'admin', 'class_session.added', 'class_session', null,
        `Added/updated calendar date ${session_date} ("${label}")`,
        { session_date, label, day_type, is_attendance_day }
      )
    }
    renderCalendarTab(userId)
  })
}

/**
 * Teacher Availability tab: a card board for a single selected date, one
 * card per class -- same grid/grouping the Today tab uses (see
 * renderTodayTab's buildStatusCard/classesByGroup), but each card shows
 * its assigned teacher(s) and whether each one is available for that date
 * instead of an attendance-submission status. Availability itself is
 * teacher-authored and teacher-editable only (see
 * data_import/27_teacher_availability.sql and teacher.js's Calendar tab);
 * this tab only reads it, nothing here writes it.
 *
 * Defaults to the next upcoming attendance-open date; the dropdown lets
 * the admin switch to any other date on the calendar. Every teacher is
 * assumed available by default -- one with no row at all for the selected
 * date displays the same as one who explicitly marked Available; only
 * Unavailable is a real opt-out, and a card with any unavailable teacher
 * gets a red left border (same "needs attention" language as a Today-tab
 * card still Waiting) so those classes stand out at a glance rather than
 * requiring reading every badge.
 */
async function renderTeacherAvailabilityTab() {
  const tabContent = document.getElementById('tab-content')
  const today = todayStr()

  const [{ data: sessions, error: sessionsError }, { data: classes, error: classesError }] = await Promise.all([
    supabase.from('class_sessions').select('session_date, label, is_attendance_day').order('session_date', { ascending: true }),
    supabase.from('classes').select('id, name, class_teachers(teacher_id, profiles(full_name))')
  ])

  const firstError = sessionsError || classesError
  if (firstError) {
    tabContent.innerHTML = `<p class="error">${ADMIN_MESSAGES.teacherAvailability.couldntLoad(firstError)}</p>`
    return
  }

  const allSessions = sessions || []
  if (allSessions.length === 0) {
    tabContent.innerHTML = `
      <p class="drag-hint">${ADMIN_MESSAGES.teacherAvailability.hint}</p>
      <p class="no-sessions">${ADMIN_MESSAGES.teacherAvailability.noUpcomingDates}</p>
    `
    return
  }

  // Same grade-order-then-alphabetical sort, then grouping under
  // Balashishyas/Madhyamshishyas/Yuvashishyas/Special Classes/Other
  // Classes headings, as the Today tab uses -- one board, same mental map
  // either tab.
  const sortedClasses = [...(classes || [])].sort((a, b) => {
    const rankA = GRADE_ORDER.indexOf(a.name)
    const rankB = GRADE_ORDER.indexOf(b.name)
    const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
    const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })
  const classesByGroup = new Map(GROUP_LABELS.map(label => [label, []]))
  sortedClasses.forEach(c => {
    classesByGroup.get(gradeGroupLabel(c.name) || OTHER_GROUP_LABEL).push(c)
  })

  // Default to the next upcoming attendance-open date; if every date has
  // already passed (e.g. browsing this tab at the very end of a season),
  // fall back to any upcoming date at all, then finally the last date on
  // the calendar -- so the dropdown never opens on nothing.
  const upcomingOpen = allSessions.filter(s => s.session_date >= today && s.is_attendance_day)
  const upcomingAny = allSessions.filter(s => s.session_date >= today)
  const defaultDate = (upcomingOpen[0] || upcomingAny[0] || allSessions[allSessions.length - 1]).session_date

  const dateOptionsHtml = allSessions
    .map(s => `<option value="${s.session_date}"${s.session_date === defaultDate ? ' selected' : ''}>${s.session_date} — ${s.label}${s.session_date === today ? ' (Today)' : ''}</option>`)
    .join('')

  tabContent.innerHTML = `
    <p class="drag-hint">${ADMIN_MESSAGES.teacherAvailability.hint}</p>
    <label class="availability-date-picker">${ADMIN_MESSAGES.teacherAvailability.dateSelectLabel}
      <select id="availability-date-select">${dateOptionsHtml}</select>
    </label>
    <div id="availability-summary"></div>
    <div id="availability-board"></div>
  `

  // Builds one class's card: its name, then one row per assigned teacher
  // (name + an Available/Unavailable badge for the selected date), or a
  // single "Unassigned" line when the class has no teacher at all -- same
  // fallback text/meaning as the Today tab's own unassigned classes.
  const buildCard = (c, statusByTeacher) => {
    const teacherLinks = c.class_teachers || []

    if (teacherLinks.length === 0) {
      return `
        <div class="status-card availability-card unassigned">
          <strong>${c.name}</strong>
          <span class="teacher-name">${ADMIN_MESSAGES.classes.unassignedBadge}</span>
        </div>
      `
    }

    let anyUnavailable = false
    const teacherRowsHtml = teacherLinks.map(ct => {
      const status = statusByTeacher.get(ct.teacher_id) || 'available'
      if (status === 'unavailable') anyUnavailable = true
      const badgeClass = status === 'unavailable' ? 'session-closed' : 'session-open'
      const badgeText = status === 'unavailable' ? ADMIN_MESSAGES.teacherAvailability.statusUnavailable : ADMIN_MESSAGES.teacherAvailability.statusAvailable
      return `
        <div class="availability-card-teacher-row">
          <span class="teacher-name">${toTitleCase(ct.profiles?.full_name) || 'Teacher'}</span>
          <span class="session-status-badge ${badgeClass}">${badgeText}</span>
        </div>
      `
    }).join('')

    return `
      <div class="status-card availability-card ${anyUnavailable ? 'has-unavailable' : 'all-available'}">
        <strong>${c.name}</strong>
        ${teacherRowsHtml}
      </div>
    `
  }

  const renderForDate = async (date) => {
    const summaryEl = document.getElementById('availability-summary')
    const board = document.getElementById('availability-board')

    const { data: marks, error } = await supabase
      .from('teacher_availability')
      .select('teacher_id, status')
      .eq('session_date', date)

    if (error) {
      summaryEl.innerHTML = ''
      board.innerHTML = `<p class="error">${ADMIN_MESSAGES.teacherAvailability.couldntLoad(error)}</p>`
      return
    }

    // Defaults to 'available' for any teacher with no row for this date --
    // see data_import/27_teacher_availability.sql and teacher.js's
    // Calendar tab: everyone is assumed available unless they've actually
    // marked themselves unavailable.
    const statusByTeacher = new Map((marks || []).map(m => [m.teacher_id, m.status]))

    // Summary counts every distinct teacher who's actually assigned to a
    // class (a teacher on two classes only counts once), not every card --
    // matches what a person would count by eye scanning the board.
    const distinctTeacherIds = new Set()
    sortedClasses.forEach(c => (c.class_teachers || []).forEach(ct => distinctTeacherIds.add(ct.teacher_id)))
    let availableCount = 0, unavailableCount = 0
    distinctTeacherIds.forEach(id => {
      if ((statusByTeacher.get(id) || 'available') === 'unavailable') unavailableCount++
      else availableCount++
    })
    summaryEl.innerHTML = `<p class="drag-hint">${ADMIN_MESSAGES.teacherAvailability.summaryStat(availableCount, unavailableCount)}</p>`

    const sections = GROUP_LABELS
      .map(label => {
        const groupClasses = classesByGroup.get(label)
        if (groupClasses.length === 0) return ''
        const cards = groupClasses.map(c => buildCard(c, statusByTeacher)).join('')
        return `<h4>${label}</h4><div class="status-grid">${cards}</div>`
      })
      .join('')

    board.innerHTML = sections || `<p>${ADMIN_MESSAGES.today.noClassesCreatedYet}</p>`
  }

  document.getElementById('availability-date-select').addEventListener('change', (e) => renderForDate(e.target.value))
  renderForDate(defaultDate)
}

// All classes were bulk-created from the backend, so the manual "Create
// Class" form is hidden for now to avoid accidental duplicate/misnamed
// classes. Flip back to true to bring it back for ad-hoc creation.
const SHOW_CREATE_CLASS_FORM = false

// Which class group the admin is currently viewing on the Classes tab --
// module-level (not local to renderClassesTab) so the choice survives a
// re-render (e.g. after assigning a teacher) instead of resetting back to
// "every group" each time. Starts as null (meaning "show everything");
// set by the group-filter dropdown built in renderClassesTab below.
let classesTabGroupFilter = null

/**
 * Classes tab: lists existing classes and provides a form to create a new
 * one, assigning it to a teacher.
 *
 * @param {string} userId - Signed-in admin's id -- threaded through to
 *   assignTeacherRefToClass/unassignTeacherRefFromClass so every
 *   assignment change is attributed in the audit trail (see audit.js).
 */

/**
 * Parses a teacher/assistant reference string used throughout this tab's
 * assignment UI (drag-and-drop chips, the "+ Add teacher" dropdown, and the
 * remove-teacher buttons) into its parts.
 *
 *  - "active:<profiles.id>" -- an already-signed-up account. Role doesn't
 *    matter here: class_teachers grants dashboard access regardless of
 *    profiles.role (see the RLS policies throughout data_import/*.sql --
 *    they all key off class_teachers membership, not role).
 *  - "pending:<role>:<email>" -- not yet signed up. `role` is 'teacher' or
 *    'assistant', written into pending_class_assignments.role so the
 *    signup trigger (data_import/50_assistant_role.sql) creates their
 *    profile with the right one.
 *
 * @param {string} ref
 * @returns {{type: 'active', id: string} | {type: 'pending', role: string, email: string}}
 */
function parseTeacherRef(ref) {
  if (ref.startsWith('active:')) {
    return { type: 'active', id: ref.slice('active:'.length) }
  }
  const rest = ref.slice('pending:'.length)
  const sep = rest.indexOf(':')
  return { type: 'pending', role: rest.slice(0, sep), email: rest.slice(sep + 1) }
}

async function renderClassesTab(userId) {
  const tabContent = document.getElementById('tab-content')

  // Everyone who's already signed up for an account and can be assigned to
  // teach a class -- plain teachers, an admin who's also personally
  // assigned to teach one (see main.js's renderDualRoleShell and
  // data_import/34_promote_vidya_to_admin.sql), AND assistants (see
  // data_import/50_assistant_role.sql). class_teachers itself never checks
  // profiles.role (see the RLS policies throughout data_import/*.sql --
  // they all key off class_teachers membership, not role), so restricting
  // this query too narrowly silently drops whoever's missing from this
  // list entirely: they'd then fall through to the "pending registration"
  // branch below instead of being recognized as already active, and the
  // already-assigned check further down (assignedRefsAnywhere, which is
  // keyed off `active:<profiles.id>`) would never match their mismatched
  // `pending:<email>` ref -- so they'd wrongly still show up in the
  // draggable "first assignment" pool (labeled "(assistant, pending)" for
  // an assistant) even after already signing up and being fully active.
  // 'assistant' was missing here from when that role was first added,
  // which is exactly this bug in practice, not just in theory.
  const { data: activeTeachers, error: activeTeachersError } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .in('role', ['teacher', 'admin', 'assistant'])

  // Every teacher/volunteer who filled out the registration form, signed
  // up or not (see data_import/08b_teacher_registrations_data.sql) -- so
  // the pool below shows everyone, not just people who've created an
  // account yet.
  const { data: registrations, error: registrationsError } = await supabase
    .from('teacher_registrations')
    .select('email, full_name, role')

  // Fetch existing classes with their assigned (active) teachers -- a
  // class can have more than one, via the class_teachers join table (see
  // data_import/06_multi_teacher_classes.sql). teacher_id (not just the
  // teacher's name) is needed here to tell which teachers are already
  // assigned to a class, for the remove button and the "+ Add teacher"
  // dropdown's available-teachers list.
  const { data: classes, error: classesError } = await supabase
    .from('classes')
    .select('*, class_teachers(teacher_id, profiles(full_name))')

  // Classes assigned to a not-yet-signed-up teacher (see
  // data_import/10_pending_class_assignments.sql) -- these take effect in
  // class_teachers automatically once that person accepts their invite
  // (data_import/08c_sync_teacher_profiles.sql), but show here in the
  // meantime so the admin can see/undo them.
  const { data: pendingAssignments, error: pendingAssignmentsError } = await supabase
    .from('pending_class_assignments')
    .select('class_id, email, role, teacher_registrations(full_name)')

  // Surface any fetch failure instead of silently rendering an empty/
  // misleading tab -- e.g. "relation does not exist" if a data_import
  // migration hasn't been run yet, or an RLS permissions error.
  const fetchErrors = [
    ['teachers', activeTeachersError],
    ['teacher registrations', registrationsError],
    ['classes', classesError],
    ['pending assignments', pendingAssignmentsError]
  ].filter(([, err]) => err)
  if (fetchErrors.length > 0) {
    fetchErrors.forEach(([label, err]) => showToast(ADMIN_MESSAGES.classes.couldntLoad(label, err)))
  }

  const pendingByClass = new Map()
  ;(pendingAssignments || []).forEach(p => {
    if (!pendingByClass.has(p.class_id)) pendingByClass.set(p.class_id, [])
    pendingByClass.get(p.class_id).push(p)
  })

  // Build dropdown options for the (hidden) create-class form -- that
  // form writes directly to classes.teacher_id, which can only ever be an
  // active account, so it deliberately doesn't offer pending teachers.
  const teacherOptions = (activeTeachers || [])
    .map(t => `<option value="${t.id}">${toTitleCase(t.full_name)}</option>`)
    .join('')

  // One combined roster for the drag-and-drop pool and "+ Add teacher"
  // dropdowns: every active teacher, plus every registration whose email
  // doesn't match an active teacher's (so someone who's already signed up
  // shows once, as active, not twice as active-and-pending).
  const activeEmails = new Set(
    (activeTeachers || []).map(t => (t.email || '').toLowerCase()).filter(Boolean)
  )
  // A not-yet-signed-up person's role is decided the first time an admin
  // assigns them to any class (teacher or assistant), and then stays fixed
  // for every class after that -- pendingRoleByEmail below is what makes
  // that stick, so the same person doesn't get offered both role choices
  // again on a later class once one is already pending. If someone somehow
  // ended up with more than one pending row in different roles (shouldn't
  // normally happen), 'teacher' wins, same tie-break as the signup trigger
  // in data_import/50_assistant_role.sql.
  const pendingRoleByEmail = new Map()
  ;(pendingAssignments || []).forEach(p => {
    const email = (p.email || '').toLowerCase()
    const existing = pendingRoleByEmail.get(email)
    if (!existing || existing === 'assistant') pendingRoleByEmail.set(email, p.role)
  })

  const teacherRoster = [
    ...(activeTeachers || []).map(t => ({ ref: `active:${t.id}`, name: toTitleCase(t.full_name), pending: false })),
    ...(registrations || [])
      .filter(r => !activeEmails.has((r.email || '').toLowerCase()))
      .flatMap(r => {
        // An actual assignment (pendingRoleByEmail) is a real decision and
        // always wins if one exists. Short of that, teacher_registrations
        // .role (data_import/54_teacher_registrations_default_role.sql)
        // lets an admin pre-decide the role at registration time -- e.g.
        // registering a batch of 12th graders specifically as Assistants
        // -- instead of only being able to decide it at first assignment.
        // Only when NEITHER exists do we fall back to offering both role
        // choices as separate roster entries (two chips/options), so the
        // admin decides at the moment they make this person's first
        // assignment.
        const decidedRole = pendingRoleByEmail.get((r.email || '').toLowerCase()) || r.role
        const roles = decidedRole ? [decidedRole] : ['teacher', 'assistant']
        return roles.map(role => ({
          ref: `pending:${role}:${r.email}`,
          name: toTitleCase(r.full_name),
          pending: true,
          role
        }))
      })
  ]

  // Every ref already assigned to *any* class, active or pending (email
  // lowercased for matching, since teacher_registrations.email casing can
  // vary; role is deliberately not part of this key -- once a pending
  // person has a class in either role, both of their role-choice roster
  // entries should drop out of the first-assignment pool). The draggable
  // pool below only shows teachers NOT in this set -- once someone has a
  // class, they drop out of the pool, since drag-and-drop is meant for a
  // teacher's first/only assignment. Giving a teacher who already has a
  // class an additional one is done through that second class's own
  // "+ Add teacher" dropdown instead (built per-class below, which is not
  // restricted this way).
  const assignedRefsAnywhere = new Set([
    ...(classes || []).flatMap(c => (c.class_teachers || []).map(ct => `active:${ct.teacher_id}`)),
    ...(pendingAssignments || []).map(p => `pending:${p.email.toLowerCase()}`)
  ])
  const normalizeRef = ref => {
    const parsed = parseTeacherRef(ref)
    return parsed.type === 'pending' ? `pending:${parsed.email.toLowerCase()}` : ref
  }
  const poolRoster = teacherRoster.filter(t => !assignedRefsAnywhere.has(normalizeRef(t.ref)))

  // Sort classes into grade order (Kindergarten, 1st Grade, 2nd Grade, ...)
  // when the class name matches a known grade; anything else (Gita,
  // Bhajan, or a custom class name) sorts after all grades, alphabetically.
  const sortedClasses = [...(classes || [])].sort((a, b) => {
    const rankA = GRADE_ORDER.indexOf(a.name)
    const rankB = GRADE_ORDER.indexOf(b.name)
    const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
    const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })

  // Group classes under their named age-group heading (Balashishyas,
  // Madhyamshishyas, Yuvashishyas -- see GRADE_GROUPS), same grouping as
  // the Today tab -- Gita/Bhajan now land in their own "Special Classes"
  // group instead of "Other Classes" (see format.js's SPECIAL_CLASS_LABEL),
  // which is left for anything else, like a volunteer team. Tag Gita/Bhajan
  // as optional classes too so it's clear they take attendance separately
  // from a grade homeroom.
  const classesByGroup = new Map(GROUP_LABELS.map(label => [label, []]))
  sortedClasses.forEach(c => {
    classesByGroup.get(gradeGroupLabel(c.name) || OTHER_GROUP_LABEL).push(c)
  })

  // First time this tab is opened this session, default the view to a
  // single group (the first one that actually has classes in it) instead
  // of dumping every card on screen at once -- that's the whole point of
  // this filter, especially on a phone screen. After that, whatever the
  // admin picked (including "All Classes") sticks across re-renders --
  // see classesTabGroupFilter above.
  if (classesTabGroupFilter === null) {
    classesTabGroupFilter = GROUP_LABELS.find(label => classesByGroup.get(label).length > 0) || GROUP_LABELS[0]
  }

  // Build one class's card: its name, a removable tag per assigned
  // teacher (active or pending), and a "+ Add teacher" select listing
  // whichever of the whole roster isn't already on it (this is the only
  // way to add a teacher who already has another class -- see
  // assignedRefsAnywhere above). The whole card is also a drag-and-drop
  // target -- see the drop handler wired up below -- so dragging a
  // teacher chip from the pool above onto this card assigns them the
  // same way. Laid out as a card grid to match the Today tab's status
  // board.
  const buildClassCard = c => {
    const optionalTag = OPTIONAL_CLASS_CODE_BY_NAME[c.name] ? ' <em>(Optional)</em>' : ''
    const classPending = pendingByClass.get(c.id) || []
    const assignedActiveIds = new Set((c.class_teachers || []).map(ct => ct.teacher_id))
    const assignedPendingEmails = new Set(classPending.map(p => p.email.toLowerCase()))

    const activeTags = (c.class_teachers || [])
      .map(ct => {
        const name = toTitleCase(ct.profiles?.full_name)
        if (!name) return ''
        return `<span class="teacher-tag">${name}<button type="button" class="remove-teacher-btn" data-class-id="${c.id}" data-class-name="${c.name}" data-teacher-ref="active:${ct.teacher_id}" data-teacher-name="${name}" title="Remove ${name}">×</button></span>`
      })
      .join('')

    const pendingTags = classPending
      .map(p => {
        const name = toTitleCase(p.teacher_registrations?.full_name) || p.email
        const roleLabel = p.role === 'assistant' ? ' (assistant, pending)' : ' (pending)'
        return `<span class="teacher-tag teacher-tag-pending">${name}${roleLabel}<button type="button" class="remove-teacher-btn" data-class-id="${c.id}" data-class-name="${c.name}" data-teacher-ref="pending:${p.role}:${p.email}" data-teacher-name="${name}" title="Remove ${name}">×</button></span>`
      })
      .join('')

    const teacherTags = (activeTags + pendingTags) || `<span class="no-teachers">${ADMIN_MESSAGES.classes.unassignedBadge}</span>`

    const availableOptions = teacherRoster
      .filter(t => {
        const parsed = parseTeacherRef(t.ref)
        return parsed.type === 'pending'
          ? !assignedPendingEmails.has(parsed.email.toLowerCase())
          : !assignedActiveIds.has(parsed.id)
      })
      .map(t => `<option value="${t.ref}">${t.name}${t.pending ? (t.role === 'assistant' ? ' (assistant, pending)' : ' (pending)') : ''}</option>`)
      .join('')

    return `
      <div class="class-card" data-class-id="${c.id}" data-class-name="${c.name}">
        <div class="class-card-name"><strong>${c.name}</strong>${optionalTag}</div>
        <div class="class-teachers">${teacherTags}</div>
        <select class="assign-teacher-select" data-class-id="${c.id}" data-class-name="${c.name}">
          <option value="">+ Add teacher</option>
          ${availableOptions}
        </select>
      </div>
    `
  }

  // "View" dropdown so the admin picks one group at a time instead of
  // every class card loading at once -- the count after each name lets
  // them see what's in a group before opening it, which matters most on a
  // small screen where a dozen-plus cards otherwise means endless
  // scrolling. classesTabGroupFilter is module-level (see above), so this
  // choice survives re-renders (e.g. right after assigning a teacher).
  const groupOptionsHtml = GROUP_LABELS
    .map(label => {
      const count = classesByGroup.get(label).length
      return `<option value="${label}"${classesTabGroupFilter === label ? ' selected' : ''}>${label} (${count})</option>`
    })
    .join('')
  const groupFilterHtml = `
    <div class="class-group-filter">
      <label for="class-group-select">Show:</label>
      <select id="class-group-select">
        ${groupOptionsHtml}
        <option value="__all__"${classesTabGroupFilter === '__all__' ? ' selected' : ''}>All Classes (${sortedClasses.length})</option>
      </select>
    </div>
  `

  const visibleGroupLabels = classesTabGroupFilter === '__all__' ? GROUP_LABELS : [classesTabGroupFilter]
  const classList = visibleGroupLabels
    .map(label => {
      const groupClasses = classesByGroup.get(label)
      if (!groupClasses || groupClasses.length === 0) return ''
      return `<h4>${label}</h4><div class="class-grid">${groupClasses.map(buildClassCard).join('')}</div>`
    })
    .join('')

  // Draggable pool of teachers who don't have a class yet -- see
  // assignedRefsAnywhere above for why this is poolRoster, not the full
  // teacherRoster.
  const teacherPoolHtml = poolRoster
    .map(t => `<span class="teacher-chip${t.pending ? ' teacher-chip-pending' : ''}" draggable="true" data-teacher-ref="${t.ref}">${t.name}${t.pending ? (t.role === 'assistant' ? ' <em>(assistant, pending)</em>' : ' <em>(pending)</em>') : ''}</span>`)
    .join('') || (teacherRoster.length === 0
      ? `<span class="no-teachers">${ADMIN_MESSAGES.classes.noTeachersFoundHint}</span>`
      : `<span class="no-teachers">${ADMIN_MESSAGES.classes.everyTeacherAssigned}</span>`)

  // Render the (optional) create-class form, the draggable teacher pool,
  // and the existing classes list
  const createClassFormHtml = SHOW_CREATE_CLASS_FORM ? `
    <h3>Create Class</h3>
    <form id="class-form">
      <input type="text" id="class-name" placeholder="Class name" required />
      <select id="teacher-select" required>
        <option value="">Select teacher</option>
        ${teacherOptions}
      </select>
      <button type="submit">Create Class</button>
    </form>
  ` : ''

  tabContent.innerHTML = `
    ${createClassFormHtml}
    <h3>Assign Teachers</h3>
    <p class="drag-hint">${ADMIN_MESSAGES.classes.hint}</p>
    <div class="teacher-pool">${teacherPoolHtml}</div>
    <div class="section-header-row">
      <h3>Existing Classes</h3>
      ${groupFilterHtml}
    </div>
    <div id="class-list">${classList || `<p>${ADMIN_MESSAGES.classes.noClassesInGroupYet}</p>`}</div>
  `

  // Optional chaining here, not because this element is ever missing under
  // normal use, but because this render can in rare cases resolve after
  // the admin has already navigated away (e.g. two renders in flight at
  // once) -- a defensive no-op beats a thrown error in that case.
  document.getElementById('class-group-select')?.addEventListener('change', (e) => {
    classesTabGroupFilter = e.target.value
    renderClassesTab(userId)
  })

  // Dragging a teacher chip carries a "active:<id>" or
  // "pending:<role>:<email>" reference via the standard HTML5 Drag and Drop
  // API -- see parseTeacherRef above.
  tabContent.querySelectorAll('.teacher-chip').forEach(chip => {
    chip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', chip.dataset.teacherRef)
      e.dataTransfer.effectAllowed = 'copy'
    })
  })

  // Dropping a teacher chip onto a class card assigns them to that class.
  // Drag-and-drop is mouse-only, so the "+ Add teacher" select on each
  // card (wired up below) does the same thing for touch/keyboard users --
  // and is also how an already-assigned teacher picks up a second class,
  // since they're no longer in the draggable pool once assigned once.
  tabContent.querySelectorAll('.class-card').forEach(card => {
    card.addEventListener('dragover', (e) => {
      e.preventDefault() // required for a drop to be allowed here
      card.classList.add('drag-over')
    })
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'))
    card.addEventListener('drop', (e) => {
      e.preventDefault()
      card.classList.remove('drag-over')
      const teacherRef = e.dataTransfer.getData('text/plain')
      if (teacherRef) {
        const teacherName = teacherRoster.find(t => t.ref === teacherRef)?.name || teacherRef
        assignTeacherRefToClass(card.dataset.classId, teacherRef, userId, card.dataset.className, teacherName)
      }
    })
  })

  tabContent.querySelectorAll('.assign-teacher-select').forEach(select => {
    select.addEventListener('change', () => {
      if (select.value) {
        const teacherName = select.options[select.selectedIndex].text
        assignTeacherRefToClass(select.dataset.classId, select.value, userId, select.dataset.className, teacherName)
      }
    })
  })

  tabContent.querySelectorAll('.remove-teacher-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      unassignTeacherRefFromClass(btn.dataset.classId, btn.dataset.teacherRef, userId, btn.dataset.className, btn.dataset.teacherName)
    })
  })

  // Handle new class creation (only wired up when the form is actually
  // rendered -- see SHOW_CREATE_CLASS_FORM above)
  if (SHOW_CREATE_CLASS_FORM) {
    document.getElementById('class-form').addEventListener('submit', async (e) => {
      e.preventDefault() // stop the browser's default full-page form submit
      const name = document.getElementById('class-name').value
      const teacherId = document.getElementById('teacher-select').value

      // teacher_id is kept in sync for backward compatibility, but
      // class_teachers is what actually grants this teacher access to the
      // class now -- see data_import/06_multi_teacher_classes.sql.
      const { data: newClass, error } = await supabase
        .from('classes')
        .insert({ name, teacher_id: teacherId })
        .select()
        .single()
      if (!error && newClass) {
        await supabase.from('class_teachers').insert({ class_id: newClass.id, teacher_id: teacherId })
        logAudit(
          userId, 'admin', 'class.created', 'class', newClass.id,
          `Created class "${name}"`,
          { class_id: newClass.id, name, teacher_id: teacherId }
        )
      }
      // Re-render the tab so the newly created class shows up in the list
      renderClassesTab(userId)
    })
  }
}

/**
 * Assigns a teacher (or assistant) to a class, then re-renders the Classes
 * tab. `ref` is either "active:<profiles.id>" (writes to class_teachers
 * directly -- see data_import/06_multi_teacher_classes.sql) or
 * "pending:<role>:<email>" (writes to pending_class_assignments instead,
 * since a not-yet-signed-up person has no profiles.id yet -- see
 * data_import/10_pending_class_assignments.sql and, for the role column,
 * data_import/50_assistant_role.sql). Used by both the drag-and-drop drop
 * handler and the "+ Add teacher" select fallback. See parseTeacherRef.
 *
 * @param {string} classId
 * @param {string} ref - "active:<id>" or "pending:<role>:<email>"
 * @param {string} userId - Signed-in admin's id, recorded as the actor.
 * @param {string} className - Display name, for the audit summary only.
 * @param {string} teacherName - Display name, for the audit summary only.
 */
async function assignTeacherRefToClass(classId, ref, userId, className, teacherName) {
  const parsed = parseTeacherRef(ref)

  const { error } = parsed.type === 'pending'
    ? await supabase.from('pending_class_assignments').insert({ class_id: classId, email: parsed.email, role: parsed.role })
    : await supabase.from('class_teachers').insert({ class_id: classId, teacher_id: parsed.id })

  if (!error) {
    showToast(parsed.type === 'pending' ? ADMIN_MESSAGES.classes.teacherAssignedPending : ADMIN_MESSAGES.classes.teacherAssigned)
    logAudit(
      userId, 'admin', 'class_teacher.assigned', 'class_teacher', classId,
      `Assigned ${teacherName} to ${className}${parsed.type === 'pending' ? ` (pending signup, as ${parsed.role})` : ''}`,
      { class_id: classId, class_name: className, teacher_ref: ref, teacher_name: teacherName }
    )
  } else if (error.code === '23505') {
    // unique_violation -- they were already assigned to this class
    showToast(ADMIN_MESSAGES.classes.alreadyAssigned)
  } else {
    showToast(ADMIN_MESSAGES.classes.couldntAssignTeacher(error))
  }
  renderClassesTab(userId)
}

/**
 * Removes a teacher/assistant (active or pending -- see
 * assignTeacherRefToClass) from a class, then re-renders the Classes tab.
 *
 * @param {string} classId
 * @param {string} ref - "active:<id>" or "pending:<role>:<email>"
 * @param {string} userId - Signed-in admin's id, recorded as the actor.
 * @param {string} className - Display name, for the audit summary only.
 * @param {string} teacherName - Display name, for the audit summary only.
 */
async function unassignTeacherRefFromClass(classId, ref, userId, className, teacherName) {
  const parsed = parseTeacherRef(ref)

  const { error } = parsed.type === 'pending'
    ? await supabase.from('pending_class_assignments').delete().eq('class_id', classId).eq('email', parsed.email)
    : await supabase.from('class_teachers').delete().eq('class_id', classId).eq('teacher_id', parsed.id)

  showToast(error ? ADMIN_MESSAGES.classes.couldntRemoveTeacher(error) : ADMIN_MESSAGES.classes.teacherRemoved)
  if (!error) {
    logAudit(
      userId, 'admin', 'class_teacher.removed', 'class_teacher', classId,
      `Removed ${teacherName} from ${className}`,
      { class_id: classId, class_name: className, teacher_ref: ref, teacher_name: teacherName }
    )
  }
  renderClassesTab(userId)
}

// Display labels + sort order for students.optional_class (the Saturday
// Gita/Bhajan session each student opted into at registration -- separate
// from their grade-level class_id).
const OPTIONAL_CLASS_ORDER = ['gita', 'bhajan', 'none']
const OPTIONAL_CLASS_LABELS = { gita: 'Bhagwad Gita', bhajan: 'Bhajan', none: 'Not Interested' }

// All students were bulk-imported from the backend, so the manual "Add
// Student" form is hidden for now to avoid accidental duplicate entries.
// Flip back to true to bring it back for ad-hoc additions.
const SHOW_ADD_STUDENT_FORM = false

/**
 * Students tab: lists all students (with their class and grade), filterable
 * by grade, and provides a form to add a new student to a class.
 *
 * @param {string} userId - Signed-in admin's id, recorded as the actor if
 *   the (currently hidden -- see SHOW_ADD_STUDENT_FORM) add-student form
 *   is ever re-enabled.
 */
async function renderStudentsTab(userId) {
  const tabContent = document.getElementById('tab-content')

  // Fetch all classes for the "Add Student" dropdown
  const { data: classes } = await supabase.from('classes').select('id, name')

  // Fetch all students with their class name and grade level
  const { data: students } = await supabase
    .from('students')
    .select('*, classes(name)')

  // Build the grade filter's options from grades actually present among
  // the students, in canonical (not alphabetical) order, plus a bucket for
  // any student with no grade_level set yet.
  const gradeRank = new Map(GRADE_ORDER.map((g, i) => [g, i]))
  const gradesPresent = new Set((students || []).map(s => s.grade_level).filter(Boolean))
  const hasUngraded = (students || []).some(s => !s.grade_level)
  const gradeOptions = GRADE_ORDER
    .filter(g => gradesPresent.has(g))
    .map(g => `<option value="${g}">${g}</option>`)
    .join('')

  // Named age-group filter options (Balashishyas, Madhyamshishyas,
  // Yuvashishyas), shown only when at least one student in that group is
  // actually present. Values are prefixed so renderStudentList can tell a
  // group selection apart from a single-grade selection.
  const groupFilterOptions = GRADE_GROUPS
    .filter(g => g.grades.some(gr => gradesPresent.has(gr)))
    .map(g => `<option value="__group__${g.key}">${g.label}</option>`)
    .join('')

  // Build the optional-class filter's options the same way
  const optionalClassesPresent = new Set((students || []).map(s => s.optional_class).filter(Boolean))
  const optionalClassOptions = OPTIONAL_CLASS_ORDER
    .filter(k => optionalClassesPresent.has(k))
    .map(k => `<option value="${k}">${OPTIONAL_CLASS_LABELS[k]}</option>`)
    .join('')

  // Build dropdown options from the class list, split into grade classes
  // (used for the student's homeroom class_id) and optional classes --
  // Gita/Bhajan don't belong in the homeroom dropdown, since a student's
  // class_id should always be their grade, never an optional class.
  const gradeClasses = (classes || []).filter(c => !OPTIONAL_CLASS_CODE_BY_NAME[c.name])
  const classOptions = gradeClasses
    .map(c => `<option value="${c.id}">${c.name}</option>`)
    .join('')

  const optionalClasses = (classes || []).filter(c => OPTIONAL_CLASS_CODE_BY_NAME[c.name])
  const optionalClassFormOptions = optionalClasses
    .map(c => {
      const code = OPTIONAL_CLASS_CODE_BY_NAME[c.name]
      return `<option value="${code}">${OPTIONAL_CLASS_LABELS[code]}</option>`
    })
    .join('')

  // Render the (optional) student form, grade filter, and an (initially
  // empty) list
  const addStudentFormHtml = SHOW_ADD_STUDENT_FORM ? `
    <h3>Add Student</h3>
    <form id="student-form">
      <input type="text" id="student-name" placeholder="Student name" required />
      <select id="student-class" required>
        <option value="">Select class</option>
        ${classOptions}
      </select>
      <select id="student-optional-class">
        <option value="">No optional class</option>
        ${optionalClassFormOptions}
      </select>
      <button type="submit">Add Student</button>
    </form>
  ` : ''

  tabContent.innerHTML = `
    ${addStudentFormHtml}
    <h3>All Students</h3>
    <div class="grade-filter">
      <input type="text" id="student-search" placeholder="${ADMIN_MESSAGES.students.searchPlaceholder}" />
      <label>Grade
        <select id="grade-filter">
          <option value="">All Grades</option>
          ${groupFilterOptions}
          ${gradeOptions}
          ${hasUngraded ? '<option value="__none__">No Grade Set</option>' : ''}
        </select>
      </label>
      <label>Optional class
        <select id="optional-class-filter">
          <option value="">All</option>
          ${optionalClassOptions}
        </select>
      </label>
      <label>Special needs
        <select id="special-needs-filter">
          <option value="">All</option>
          <option value="yes">Special Needs Only</option>
          <option value="no">No Special Needs</option>
        </select>
      </label>
      <label>New joiner
        <select id="new-joiner-filter">
          <option value="">All</option>
          <option value="yes">New Joiners Only</option>
          <option value="no">Returning Students</option>
        </select>
      </label>
    </div>
    <p id="student-count" class="result-count"></p>
    <ul id="student-list"></ul>
  `

  // Render the student list, filtered by name search, grade, optional
  // Saturday class, special needs, and/or new-joiner status ('' means no
  // filter on that dimension; '__none__' on the grade filter means only
  // ungraded students), sorted by grade then name. All filters combine
  // (every one that's set must match), same as the Log Hours tab's search
  // + grade filter (see teacher.js's applyFilters).
  function renderStudentList(nameFilter, gradeFilter, optionalClassFilter, specialNeedsFilter, newJoinerFilter) {
    const list = document.getElementById('student-list')
    const term = nameFilter.trim().toLowerCase()
    const filtered = (students || [])
      .filter(s => {
        if (term && !(s.full_name || '').toLowerCase().includes(term)) return false
        // A grade-filter value of "__group__<key>" selects an entire named
        // age-group (e.g. all of Balashishyas) at once; otherwise it's
        // either "__none__" (ungraded only) or one specific grade name.
        if (gradeFilter.startsWith('__group__')) {
          const group = GRADE_GROUPS.find(g => g.key === gradeFilter.slice('__group__'.length))
          if (group && !group.grades.includes(s.grade_level)) return false
        } else if (gradeFilter === '__none__' && s.grade_level) {
          return false
        } else if (gradeFilter && s.grade_level !== gradeFilter) {
          return false
        }
        if (optionalClassFilter && s.optional_class !== optionalClassFilter) return false
        // special_needs / returning_student may be null for rows the
        // registration data left blank -- treat null as "unknown", so it
        // only shows up under "All", not under either Yes/No option.
        if (specialNeedsFilter === 'yes' && s.special_needs !== true) return false
        if (specialNeedsFilter === 'no' && s.special_needs !== false) return false
        // "New joiner" is the opposite of returning_student
        if (newJoinerFilter === 'yes' && s.returning_student !== false) return false
        if (newJoinerFilter === 'no' && s.returning_student !== true) return false
        return true
      })
      .sort((a, b) => {
        const rankA = gradeRank.has(a.grade_level) ? gradeRank.get(a.grade_level) : GRADE_ORDER.length
        const rankB = gradeRank.has(b.grade_level) ? gradeRank.get(b.grade_level) : GRADE_ORDER.length
        if (rankA !== rankB) return rankA - rankB
        return (a.full_name || '').localeCompare(b.full_name || '')
      })

    list.innerHTML = filtered
      .map((s, i) => {
        const className = s.classes?.name || 'No Class'
        // Only show the class name when it says something the grade
        // doesn't already -- for imported students the class is literally
        // named after the grade (e.g. "6th Grade"), so showing both would
        // just repeat the same text twice.
        const classPart = className !== s.grade_level ? ` (${className})` : ''
        const gradePart = s.grade_level ? ` — ${s.grade_level}` : ''
        // Only call out an opted-in Saturday class, not "Not Interested"
        const optionalPart = (s.optional_class === 'gita' || s.optional_class === 'bhajan')
          ? ` · ${OPTIONAL_CLASS_LABELS[s.optional_class]}`
          : ''
        // Only call out special needs / new-joiner status when true, so
        // the common case (no special needs, returning student) doesn't
        // clutter every row
        const specialNeedsPart = s.special_needs === true ? ' · Special Needs' : ''
        const newJoinerPart = s.returning_student === false ? ' · New Joiner' : ''
        return `<li>${i + 1}. ${toTitleCase(s.full_name)}${gradePart}${classPart}${optionalPart}${specialNeedsPart}${newJoinerPart}</li>`
      })
      .join('') || `<li>${ADMIN_MESSAGES.students.noStudentsMatchFilter}</li>`

    // Shown right above the list (not just implied by scrolling to the
    // bottom) so a narrowed-down search doesn't require scrolling through
    // however many rows matched just to find out how many that was.
    document.getElementById('student-count').textContent =
      ADMIN_MESSAGES.students.resultsCount(filtered.length, (students || []).length)
  }

  renderStudentList('', '', '', '', '')

  // Re-filter (no re-fetch needed) whenever the search box or any dropdown
  // changes, reading all current selections so the filters combine.
  const searchEl = document.getElementById('student-search')
  const gradeFilterEl = document.getElementById('grade-filter')
  const optionalClassFilterEl = document.getElementById('optional-class-filter')
  const specialNeedsFilterEl = document.getElementById('special-needs-filter')
  const newJoinerFilterEl = document.getElementById('new-joiner-filter')
  const applyFilters = () => renderStudentList(
    searchEl.value,
    gradeFilterEl.value,
    optionalClassFilterEl.value,
    specialNeedsFilterEl.value,
    newJoinerFilterEl.value
  )
  searchEl.addEventListener('input', applyFilters)
  gradeFilterEl.addEventListener('change', applyFilters)
  optionalClassFilterEl.addEventListener('change', applyFilters)
  specialNeedsFilterEl.addEventListener('change', applyFilters)
  newJoinerFilterEl.addEventListener('change', applyFilters)

  // Handle new student form submission (only wired up when the form is
  // actually rendered -- see SHOW_ADD_STUDENT_FORM above)
  if (SHOW_ADD_STUDENT_FORM) {
    document.getElementById('student-form').addEventListener('submit', async (e) => {
      e.preventDefault() // stop the browser's default full-page form submit
      const fullName = document.getElementById('student-name').value
      const classId = document.getElementById('student-class').value
      const optionalClass = document.getElementById('student-optional-class').value || null

      const { data: newStudent } = await supabase.from('students').insert({
        full_name: fullName,
        class_id: classId,
        optional_class: optionalClass
      }).select().single()
      if (newStudent) {
        logAudit(
          userId, 'admin', 'student.created', 'student', newStudent.id,
          `Added student "${fullName}"`,
          { student_id: newStudent.id, full_name: fullName, class_id: classId, optional_class: optionalClass }
        )
      }
      // Re-render the tab so the newly added student shows up in the list
      renderStudentsTab(userId)
    })
  }
}

/**
 * Records tab: two subsections under one shared date-range filter -- one
 * place for all history rather than splitting it across tabs.
 *  - "Attendance Records": student attendance (summaries + a detailed,
 *    filterable log grouped by date and class), teacher attendance (see
 *    data_import/18_teacher_attendance.sql), and lesson notes -- what each
 *    class's teacher wrote they covered that day (see
 *    data_import/30_class_lesson_notes.sql) -- as three clearly separate
 *    sub-sections. Lesson notes only ever showed up live, on the Today
 *    tab's review modal for the current date -- this is the only place an
 *    admin can look back at what was actually taught on a past date, by
 *    class or by teacher.
 *  - "Volunteer Hour Records": a read-only, cross-team log of ACCEPTED
 *    volunteer hours (see loadVolunteerHoursRecordsRange) -- anything
 *    still pending review lives on the Volunteer Hours tab (and the Today
 *    tab's pending card), not here; this is finalized history only.
 * Defaults to showing just today's records.
 *
 * Also hosts the "+ Backfill Attendance" panel (see wireBackfillPanel and
 * openBackfillModal below) -- lives here rather than on the Today tab
 * since it's specifically for a class + past date that already has no (or
 * incomplete) data, which is exactly what this tab is for looking up in
 * the first place.
 *
 * @param {string} userId - Signed-in admin's id, recorded as `marked_by`
 *   on any row the Backfill Attendance panel inserts, and as the actor on
 *   the audit_log entry a save there writes.
 */
async function renderRecordsTab(userId) {
  const tabContent = document.getElementById('tab-content')
  const today = todayStr()
  // Default "From" to a week ago rather than today, so the Records tab
  // opens showing the last 7 days (today inclusive) instead of a single
  // day -- the admin can still narrow it back down to one day via the
  // date pickers below. Computed at UTC noon, same DST-safe approach as
  // teacher.js's dateMinusDays, since this is the only place admin.js
  // needs to subtract days from a date string.
  const weekAgo = (() => {
    const d = new Date(`${today}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() - 6)
    return d.toISOString().slice(0, 10)
  })()

  tabContent.innerHTML = `
    <div class="date-range">
      <label>From: <input type="date" id="start-date" value="${weekAgo}" /></label>
      <label>To: <input type="date" id="end-date" value="${today}" /></label>
      <button id="filter-btn">Filter</button>
    </div>

    <button type="button" id="backfill-toggle-btn">${ADMIN_MESSAGES.records.backfill.openButtonLabel}</button>
    <div id="backfill-panel" class="records-section hidden">
      <h4>${ADMIN_MESSAGES.records.backfill.heading}</h4>
      <p class="drag-hint">${ADMIN_MESSAGES.records.backfill.hint}</p>
      <div class="date-range">
        <label>${ADMIN_MESSAGES.records.backfill.classLabel}:
          <select id="backfill-class-select">
            <option value="">${ADMIN_MESSAGES.records.backfill.classPlaceholder}</option>
          </select>
        </label>
        <label>${ADMIN_MESSAGES.records.backfill.dateLabel}: <input type="date" id="backfill-date-input" max="${today}" /></label>
        <button type="button" id="backfill-load-btn">${ADMIN_MESSAGES.records.backfill.loadButtonLabel}</button>
      </div>
      <p class="backfill-panel-message hidden"></p>
    </div>

    <details class="records-section records-accordion-item">
      <summary>Student Attendance</summary>
      <div class="records-accordion-body">
        <div id="summary-cards"></div>
        <div id="records-list"></div>
      </div>
    </details>

    <details class="records-section records-accordion-item">
      <summary>Teacher Attendance</summary>
      <div class="records-accordion-body">
        <div id="teacher-attendance-list"></div>
      </div>
    </details>

    <details class="records-section records-accordion-item">
      <summary>Lesson Notes</summary>
      <div class="records-accordion-body">
        <div id="lesson-notes-list"></div>
      </div>
    </details>

    <details class="records-section records-accordion-item">
      <summary>Volunteer Hour Records</summary>
      <div class="records-accordion-body">
        <div id="volunteer-records-list"></div>
      </div>
    </details>

    <details class="records-section records-accordion-item">
      <summary>Smile Box</summary>
      <div class="records-accordion-body">
        <div id="smile-box-records-list"></div>
      </div>
    </details>
  `

  // Accordion behavior: only one section open at a time -- opening one
  // closes whichever other section was already open, rather than letting
  // several stack up open together. Native <details>/<summary> already
  // gives us the expand/collapse mechanics (same element this file already
  // uses for "Earlier records" -- see buildCollapsibleDateGroups); this
  // just adds the "only one at a time" behavior on top via the 'toggle'
  // event, which fires whenever a <details> element's open state changes.
  const accordionItems = [...tabContent.querySelectorAll('.records-accordion-item')]
  accordionItems.forEach(item => {
    item.addEventListener('toggle', () => {
      if (item.open) accordionItems.forEach(other => { if (other !== item) other.open = false })
    })
  })

  // Re-query and re-render every section together when the user picks a
  // new date range, so one filter covers all of them instead of separate
  // date pickers to keep in sync.
  document.getElementById('filter-btn').addEventListener('click', () => {
    const startDate = document.getElementById('start-date').value
    const endDate = document.getElementById('end-date').value
    loadRecordsRange(startDate, endDate)
    loadTeacherAttendanceRange(startDate, endDate)
    loadLessonNotesRange(startDate, endDate)
    loadVolunteerHoursRecordsRange(startDate, endDate)
    loadSmileBoxRange(startDate, endDate)
  })

  // Initial load: the last 7 days (matching the date pickers' default
  // above) for every section. Sections start collapsed (no `open`
  // attribute above), but the content loads into them regardless so it's
  // ready the instant the admin expands one.
  loadRecordsRange(weekAgo, today)
  loadTeacherAttendanceRange(weekAgo, today)
  loadLessonNotesRange(weekAgo, today)
  loadVolunteerHoursRecordsRange(weekAgo, today)
  loadSmileBoxRange(weekAgo, today)

  wireBackfillPanel(userId)
}

/**
 * Wires the Records tab's "+ Backfill Attendance" button and the panel it
 * reveals (see renderRecordsTab's template above): populates the class
 * dropdown, and opens openBackfillModal for whichever class + date the
 * admin picks and clicks Load for.
 *
 * @param {string} userId - Threaded straight through to openBackfillModal.
 */
async function wireBackfillPanel(userId) {
  const toggleBtn = document.getElementById('backfill-toggle-btn')
  const panel = document.getElementById('backfill-panel')
  const classSelect = document.getElementById('backfill-class-select')
  const dateInput = document.getElementById('backfill-date-input')
  const loadBtn = document.getElementById('backfill-load-btn')
  const msg = panel.querySelector('.backfill-panel-message')

  toggleBtn.addEventListener('click', () => panel.classList.toggle('hidden'))

  // Same grade-order-first sort as the Today tab's status board (see
  // renderTodayTab's sortedClasses above), so Gita/Bhajan/volunteer teams
  // land after every grade rather than wherever alphabetical order
  // happens to put them.
  const { data: classes } = await supabase.from('classes').select('id, name').order('name')
  const sortedClasses = [...(classes || [])].sort((a, b) => {
    const rankA = GRADE_ORDER.indexOf(a.name)
    const rankB = GRADE_ORDER.indexOf(b.name)
    const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
    const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.name.localeCompare(b.name)
  })
  classSelect.insertAdjacentHTML('beforeend', sortedClasses.map(c => `<option value="${c.id}">${c.name}</option>`).join(''))

  const showMsg = (text, kind) => {
    msg.textContent = text
    msg.className = `backfill-panel-message ${kind}`
    msg.classList.remove('hidden')
  }

  loadBtn.addEventListener('click', () => {
    const classId = classSelect.value
    const date = dateInput.value
    if (!classId || !date) {
      showMsg(ADMIN_MESSAGES.records.backfill.pickClassAndDate, 'error')
      return
    }
    if (date > todayStr()) {
      showMsg(ADMIN_MESSAGES.records.backfill.futureDateError, 'error')
      return
    }
    msg.classList.add('hidden')
    const className = classSelect.options[classSelect.selectedIndex].text
    openBackfillModal(classId, className, date, userId)
  })
}

/**
 * Fetch attendance records within [startDate, endDate] (inclusive) and
 * render the per-class summary cards, plus either:
 *  - a single day (startDate === endDate): the full day-by-day,
 *    name-by-name list, same as before -- short enough on one day to be
 *    genuinely useful (exactly what got submitted), and this is the
 *    default view.
 *  - a wider range: two compact, actionable metrics instead --
 *    "Needs Follow-up" and "Perfect Attendance" -- rather than repeating
 *    every individual record for every day in the range. That full
 *    detail already exists (in the underlying table, and in each day's
 *    own single-day view), so re-listing all of it here for a week or
 *    month at a time added length without adding anything an admin could
 *    actually act on.
 *
 * @param {string} startDate - 'YYYY-MM-DD', inclusive range start.
 * @param {string} endDate - 'YYYY-MM-DD', inclusive range end.
 */
async function loadRecordsRange(startDate, endDate) {
  const summaryCards = document.getElementById('summary-cards')
  const recordsList = document.getElementById('records-list')

  // student_id (not just the embedded students(full_name)) is needed to
  // group a student's records reliably across dates/classes below --
  // full_name alone could collide between two different students.
  const { data: records, error } = await supabase
    .from('attendance')
    .select('date, status, student_id, students(full_name), classes(name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error fetching records:', error)
    summaryCards.innerHTML = `<p class="error">${ADMIN_MESSAGES.records.errorLoadingSummaries}</p>`
    recordsList.innerHTML = `<p class="error">${ADMIN_MESSAGES.records.errorLoadingRecords}</p>`
    return
  }

  if (!records || records.length === 0) {
    summaryCards.innerHTML = ''
    recordsList.innerHTML = `<p>${ADMIN_MESSAGES.records.noRecordsForRange}</p>`
    return
  }

  // Track per-class totals (summary cards) and per-student totals (the
  // two range metrics below) in a single pass.
  const classSummary = {}
  const studentSummary = {}
  records.forEach(r => {
    const className = r.classes?.name || 'Unknown'
    if (!classSummary[className]) classSummary[className] = { present: 0, total: 0 }
    classSummary[className].total++
    if (r.status === 'present') classSummary[className].present++

    if (r.student_id) {
      if (!studentSummary[r.student_id]) {
        studentSummary[r.student_id] = { name: r.students?.full_name, present: 0, absent: 0, total: 0 }
      }
      const s = studentSummary[r.student_id]
      s.total++
      if (r.status === 'present') s.present++
      else s.absent++
    }
  })

  // Grade order (Kindergarten, 1st Grade, 2nd Grade, ...), then anything
  // not a grade name (Gita, Bhajan, a volunteer team) alphabetically after
  // -- same GRADE_ORDER.indexOf comparator used for sortedClasses in the
  // Today/Classes/Teacher Availability tabs above, applied here too since
  // `classSummary`'s keys otherwise come out in whatever order distinct
  // class names first happened to appear while scanning `records` (which
  // is only sorted by date), not any order a person would expect.
  const orderedClassNames = Object.keys(classSummary).sort((a, b) => {
    const rankA = GRADE_ORDER.indexOf(a)
    const rankB = GRADE_ORDER.indexOf(b)
    const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
    const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
    if (orderA !== orderB) return orderA - orderB
    return a.localeCompare(b)
  })

  // Same grouping the Today/Classes/Teacher Availability tabs use --
  // Balashishyas/Madhyamshishyas/Yuvashishyas by grade, then Special
  // Classes (Gita/Bhajan), then Other Classes (a volunteer team, or
  // anything else) -- as its own labeled section instead of one flat grid,
  // so a wide date range's summary reads the same way classes are grouped
  // everywhere else in the admin dashboard.
  const namesByGroup = new Map(GROUP_LABELS.map(label => [label, []]))
  orderedClassNames.forEach(name => {
    namesByGroup.get(gradeGroupLabel(name) || OTHER_GROUP_LABEL).push(name)
  })

  // Attendance rate per class -- shown for any range, single day or wide.
  const buildSummaryCard = (className) => {
    const counts = classSummary[className]
    const pct = Math.round((counts.present / counts.total) * 100)
    return `
      <div class="summary-card">
        <strong>${className}</strong>
        <span class="pct">${pct}% present</span>
        <span class="detail">${counts.present}/${counts.total}</span>
      </div>
    `
  }

  summaryCards.innerHTML = GROUP_LABELS
    .map(label => {
      const names = namesByGroup.get(label)
      if (names.length === 0) return ''
      return `<h4>${label}</h4><div class="summary-grid">${names.map(buildSummaryCard).join('')}</div>`
    })
    .join('')

  if (startDate === endDate) {
    const dateGrouped = {}
    records.forEach(r => {
      const className = r.classes?.name || 'Unknown'
      if (!dateGrouped[r.date]) dateGrouped[r.date] = {}
      if (!dateGrouped[r.date][className]) dateGrouped[r.date][className] = []
      dateGrouped[r.date][className].push(r)
    })
    // Always exactly one date here (startDate === endDate) -- no need for
    // the older-dates-collapse treatment loadTeacherAttendanceRange and
    // loadVolunteerHoursRecordsRange use for a wider range.
    let detailHtml = ''
    for (const [date, classes] of Object.entries(dateGrouped)) {
      detailHtml += `<div class="records-date-group"><h4>${date}</h4>`
      for (const [className, entries] of Object.entries(classes)) {
        detailHtml += `<div class="records-team-block"><strong>${className}</strong><ul>`
        entries.forEach(entry => {
          const statusClass = entry.status === 'present' ? 'present' : 'absent'
          detailHtml += `<li class="${statusClass}">${toTitleCase(entry.students?.full_name)} — ${entry.status}</li>`
        })
        detailHtml += '</ul></div>'
      }
      detailHtml += '</div>'
    }
    recordsList.innerHTML = detailHtml
    return
  }

  const students = Object.values(studentSummary).filter(s => s.name)

  // Most-missed first -- the students most worth a follow-up call belong
  // at the top, not buried alphabetically.
  const followUp = students
    .filter(s => s.absent > RECORDS_FOLLOW_UP_ABSENCE_THRESHOLD)
    .sort((a, b) => b.absent - a.absent)

  const perfect = students
    .filter(s => s.absent === 0)
    .sort((a, b) => a.name.localeCompare(b.name))

  const buildMetricRow = (name, statText) => `
    <div class="metric-row">
      <span>${toTitleCase(name)}</span>
      <span class="metric-stat">${statText}</span>
    </div>
  `

  recordsList.innerHTML = `
    <div class="metric-section">
      <h4>${ADMIN_MESSAGES.records.followUpHeading}</h4>
      ${followUp.length
        ? `<div class="metric-list">${followUp.map(s => buildMetricRow(s.name, ADMIN_MESSAGES.records.followUpStat(s.absent, s.total))).join('')}</div>`
        : `<p class="success">${ADMIN_MESSAGES.records.followUpNone}</p>`}
    </div>
    <div class="metric-section">
      <h4>${ADMIN_MESSAGES.records.perfectAttendanceHeading}</h4>
      ${perfect.length
        ? `<div class="metric-list">${perfect.map(s => buildMetricRow(s.name, ADMIN_MESSAGES.records.perfectAttendanceStat(s.total))).join('')}</div>`
        : `<p>${ADMIN_MESSAGES.records.noPerfectAttendance}</p>`}
    </div>
  `
}

/**
 * Renders a date-grouped set of record blocks as: the most recent date
 * shown directly, and -- only if there's more than one date -- every
 * older date collapsed behind a single "Earlier records" toggle. Same
 * collapsed-by-default past-sessions pattern as the Calendar tab's "Past
 * Dates", applied here so picking a wide date range in either
 * loadTeacherAttendanceRange or loadVolunteerHoursRecordsRange doesn't
 * dump dozens of dates flat down the page -- only today's (or the most
 * recent day's) records show by default, with history a click away.
 *
 * @param {[string, string][]} dateEntries - `[date, innerHtmlForThatDate]`
 *   pairs, already newest-first (both call sites' queries sort
 *   `date desc`, and `Object.entries` on an object built by iterating them
 *   preserves that order since date strings aren't array-index keys).
 * @param {(date: string, bodyHtml: string) => string} wrapDate - Builds
 *   one date's full block (heading + content) from its date and inner html.
 * @returns {string}
 */
function buildCollapsibleDateGroups(dateEntries, wrapDate) {
  if (dateEntries.length === 0) return ''
  const [mostRecent, ...older] = dateEntries
  const recentHtml = wrapDate(mostRecent[0], mostRecent[1])
  if (older.length === 0) return recentHtml
  const olderHtml = older.map(([date, bodyHtml]) => wrapDate(date, bodyHtml)).join('')
  return `
    ${recentHtml}
    <details class="past-sessions">
      <summary>Earlier records (${older.length} more date${older.length === 1 ? '' : 's'})</summary>
      <div class="session-list">${olderHtml}</div>
    </details>
  `
}

/**
 * Fetch teacher_attendance records within [startDate, endDate] (inclusive)
 * and render them grouped by date, then class -- the "Teacher Attendance"
 * section of the Records tab (see renderRecordsTab above and
 * data_import/18_teacher_attendance.sql).
 *
 * `profiles!teacher_attendance_teacher_id_fkey` disambiguates which of
 * teacher_attendance's two foreign keys into profiles (teacher_id vs.
 * marked_by) this embed follows -- without it PostgREST can't tell which
 * relationship "profiles" should mean.
 *
 * @param {string} startDate - 'YYYY-MM-DD', inclusive range start.
 * @param {string} endDate - 'YYYY-MM-DD', inclusive range end.
 */
async function loadTeacherAttendanceRange(startDate, endDate) {
  const list = document.getElementById('teacher-attendance-list')

  const { data: records, error } = await supabase
    .from('teacher_attendance')
    .select('date, status, teacher_id, classes(name), profiles!teacher_attendance_teacher_id_fkey(full_name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error fetching teacher attendance:', error)
    list.innerHTML = `<p class="error">${ADMIN_MESSAGES.teacherAttendance.errorLoading}</p>`
    return
  }

  if (!records || records.length === 0) {
    list.innerHTML = `<p>${ADMIN_MESSAGES.teacherAttendance.noRecordsForRange}</p>`
    return
  }

  // Group by date, then by class within each date -- same shape as the
  // Records tab's detailed list.
  const dateGrouped = {}
  records.forEach(r => {
    const className = r.classes?.name || 'Unknown'
    if (!dateGrouped[r.date]) dateGrouped[r.date] = {}
    if (!dateGrouped[r.date][className]) dateGrouped[r.date][className] = []
    dateGrouped[r.date][className].push(r)
  })

  const dateBodies = Object.entries(dateGrouped).map(([date, classes]) => {
    // Within each date, group classes the same way the Today/Classes/
    // Teacher Availability tabs (and the Student Attendance summary above)
    // do -- Balashishyas/Madhyamshishyas/Yuvashishyas by grade, then
    // Special Classes (Gita/Bhajan), then Other Classes -- instead of
    // `Object.entries(classes)`'s insertion order, which otherwise came
    // out however distinct class names first appeared among that date's
    // rows.
    const classNames = Object.keys(classes).sort((a, b) => {
      const rankA = GRADE_ORDER.indexOf(a)
      const rankB = GRADE_ORDER.indexOf(b)
      const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
      const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
      if (orderA !== orderB) return orderA - orderB
      return a.localeCompare(b)
    })
    const namesByGroup = new Map(GROUP_LABELS.map(label => [label, []]))
    classNames.forEach(name => {
      namesByGroup.get(gradeGroupLabel(name) || OTHER_GROUP_LABEL).push(name)
    })

    // Every class a given teacher marked attendance for on this date --
    // usually just one, but a teacher assigned to more than one class
    // (e.g. a grade homeroom plus Gita) can show up under more than one
    // class block below. Keyed by teacher_id, not name, so two different
    // teachers who happen to share a full_name are never conflated.
    const classesByTeacher = new Map()
    Object.entries(classes).forEach(([className, entries]) => {
      entries.forEach(entry => {
        if (!entry.teacher_id) return
        if (!classesByTeacher.has(entry.teacher_id)) classesByTeacher.set(entry.teacher_id, new Set())
        classesByTeacher.get(entry.teacher_id).add(className)
      })
    })

    const buildClassBlock = (className) => {
      const rows = classes[className].map(entry => {
        const statusClass = entry.status === 'present' ? 'present' : 'absent'
        // If this teacher has another class on this same date, say so
        // right here instead of leaving their name to just quietly repeat
        // under that other class block with no explanation.
        const otherClasses = entry.teacher_id
          ? [...(classesByTeacher.get(entry.teacher_id) || [])].filter(c => c !== className)
          : []
        const multiClassNote = otherClasses.length > 0
          ? ` <span class="also-taught-note">(${ADMIN_MESSAGES.teacherAttendance.alsoTeaching(otherClasses)})</span>`
          : ''
        return `<li class="${statusClass}">${toTitleCase(entry.profiles?.full_name)} — ${entry.status}${multiClassNote}</li>`
      }).join('')
      return `<div class="records-team-block"><strong>${className}</strong><ul>${rows}</ul></div>`
    }

    const body = GROUP_LABELS
      .map(label => {
        const names = namesByGroup.get(label)
        if (names.length === 0) return ''
        return `<h5>${label}</h5>${names.map(buildClassBlock).join('')}`
      })
      .join('')
    return [date, body]
  })

  list.innerHTML = buildCollapsibleDateGroups(
    dateBodies,
    (date, body) => `<div class="records-date-group"><h4>${date}</h4>${body}</div>`
  )
}

/**
 * Fetch class_lesson_notes within [startDate, endDate] (inclusive) and
 * render them grouped by date, then class -- the "Lesson Notes"
 * subsection of the Records tab (see renderRecordsTab and
 * data_import/30_class_lesson_notes.sql). Before this existed, a lesson
 * note was only ever visible live, on the Today tab's review modal, for
 * the current date -- this is the only place an admin can look back at
 * what a class's teacher actually wrote they covered on a past date.
 *
 * Reuses buildLessonNoteBubbleHtml (see teacher.js) so a note renders as
 * the exact same WhatsApp-style bubble here as it does on the teacher's
 * own screen and the Today tab's review modal -- one shared look for a
 * lesson note everywhere it appears, not a second, differently-styled
 * rendering just for this history view.
 *
 * class_lesson_notes only has one foreign key into profiles (teacher_id),
 * unlike teacher_attendance's two -- so `profiles(full_name)` needs no
 * `!fkey` disambiguation the way loadTeacherAttendanceRange's query does.
 *
 * @param {string} startDate - 'YYYY-MM-DD', inclusive range start.
 * @param {string} endDate - 'YYYY-MM-DD', inclusive range end.
 */
async function loadLessonNotesRange(startDate, endDate) {
  const list = document.getElementById('lesson-notes-list')

  const { data: records, error } = await supabase
    .from('class_lesson_notes')
    .select('date, note, classes(name), profiles(full_name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error fetching lesson notes:', error)
    list.innerHTML = `<p class="error">${ADMIN_MESSAGES.lessonNotesRecords.errorLoading}</p>`
    return
  }

  if (!records || records.length === 0) {
    list.innerHTML = `<p>${ADMIN_MESSAGES.lessonNotesRecords.noRecordsForRange}</p>`
    return
  }

  // Group by date, then by class within each date, same shape as the
  // Teacher Attendance subsection just above.
  const dateGrouped = {}
  records.forEach(r => {
    const className = r.classes?.name || 'Unknown'
    if (!dateGrouped[r.date]) dateGrouped[r.date] = {}
    if (!dateGrouped[r.date][className]) dateGrouped[r.date][className] = []
    dateGrouped[r.date][className].push(r)
  })

  const dateBodies = Object.entries(dateGrouped).map(([date, classes]) => {
    // Same grade/Special Classes/Other Classes grouping as Teacher
    // Attendance and the Student Attendance summary above.
    const classNames = Object.keys(classes).sort((a, b) => {
      const rankA = GRADE_ORDER.indexOf(a)
      const rankB = GRADE_ORDER.indexOf(b)
      const orderA = rankA === -1 ? GRADE_ORDER.length : rankA
      const orderB = rankB === -1 ? GRADE_ORDER.length : rankB
      if (orderA !== orderB) return orderA - orderB
      return a.localeCompare(b)
    })
    const namesByGroup = new Map(GROUP_LABELS.map(label => [label, []]))
    classNames.forEach(name => {
      namesByGroup.get(gradeGroupLabel(name) || OTHER_GROUP_LABEL).push(name)
    })

    // A class's note is unique per (class_id, date) -- data_import/30_'s
    // own unique constraint -- so there's exactly one entry per class
    // here, never a list to loop over the way Teacher Attendance's rows
    // are.
    const buildClassBlock = (className) => {
      const entry = classes[className][0]
      const teacherLabel = toTitleCase(entry.profiles?.full_name) || ADMIN_MESSAGES.lessonNotesRecords.unknownTeacher
      const bubbleHtml = buildLessonNoteBubbleHtml(entry.note)
      const noteHtml = bubbleHtml || `<p class="lesson-note-bubble-empty">${ADMIN_MESSAGES.lessonNotesRecords.noNote}</p>`
      return `
        <div class="records-team-block">
          <strong>${className}</strong>
          <span class="lesson-note-record-teacher">${ADMIN_MESSAGES.lessonNotesRecords.byTeacher(teacherLabel)}</span>
          ${noteHtml}
        </div>
      `
    }

    const body = GROUP_LABELS
      .map(label => {
        const names = namesByGroup.get(label)
        if (names.length === 0) return ''
        return `<h5>${label}</h5>${names.map(buildClassBlock).join('')}`
      })
      .join('')
    return [date, body]
  })

  list.innerHTML = buildCollapsibleDateGroups(
    dateBodies,
    (date, body) => `<div class="records-date-group"><h4>${date}</h4>${body}</div>`
  )
}

/**
 * Fetch ACCEPTED volunteer_hours within [startDate, endDate] (inclusive),
 * across every team, and render them grouped by date then team -- the
 * "Volunteer Hour Records" subsection of the Records tab (see
 * renderRecordsTab). Same grouped date/sub-heading shape as
 * loadTeacherAttendanceRange just above. Pending (unapproved) entries are
 * deliberately excluded -- they're not a finalized record yet; see this
 * app's convention on that (renderVolunteerPendingSection, and
 * ADMIN_MESSAGES.volunteerHours.pendingHint).
 *
 * @param {string} startDate - 'YYYY-MM-DD', inclusive range start.
 * @param {string} endDate - 'YYYY-MM-DD', inclusive range end.
 */
async function loadVolunteerHoursRecordsRange(startDate, endDate) {
  const list = document.getElementById('volunteer-records-list')

  const { data: records, error } = await supabase
    .from('volunteer_hours')
    .select('date, hours, note, students(full_name), classes(name)')
    .eq('approved', true)
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error fetching volunteer hour records:', error)
    list.innerHTML = `<p class="error">${ADMIN_MESSAGES.volunteerHoursRecords.errorLoading(error)}</p>`
    return
  }

  if (!records || records.length === 0) {
    list.innerHTML = `<p>${ADMIN_MESSAGES.volunteerHoursRecords.noRecordsForRange}</p>`
    return
  }

  const dateGrouped = {}
  records.forEach(r => {
    const teamName = r.classes?.name || 'Unknown'
    if (!dateGrouped[r.date]) dateGrouped[r.date] = {}
    if (!dateGrouped[r.date][teamName]) dateGrouped[r.date][teamName] = []
    dateGrouped[r.date][teamName].push(r)
  })

  // Reuses .metric-list/.metric-row -- the same card-row look the
  // Volunteer Hours tab's own Activity Log uses for this exact data
  // shape (name + a stat), rather than plain bulleted text.
  const dateBodies = Object.entries(dateGrouped).map(([date, teams]) => {
    const body = Object.entries(teams).map(([teamName, entries]) => {
      const rows = entries.map(entry => {
        const noteSuffix = entry.note ? ` — ${entry.note}` : ''
        return `
          <div class="metric-row">
            <span>${toTitleCase(entry.students?.full_name)}</span>
            <span class="metric-stat">${ADMIN_MESSAGES.volunteerHours.totalStat(Number(entry.hours))}${noteSuffix}</span>
          </div>
        `
      }).join('')
      return `<div class="records-team-block"><strong>${teamName}</strong><div class="metric-list">${rows}</div></div>`
    }).join('')
    return [date, body]
  })

  list.innerHTML = buildCollapsibleDateGroups(
    dateBodies,
    (date, body) => `<div class="records-date-group"><h4>${date}</h4>${body}</div>`
  )
}

/**
 * "Smile Box" subsection of the Records tab (see renderRecordsTab and
 * data_import/45_smile_box.sql) -- a read-only, date-range-filtered mirror
 * of the exact same shared wall every teacher already sees on their own
 * Smile Box tab (see teacher.js's renderSmileBoxTab/buildSmileBoxWallHtml).
 * Author names are fetched as a separate follow-up query rather than a
 * PostgREST embed, same reasoning as teacher.js's renderSmileBoxTab: this
 * table has two separate foreign keys into profiles (author_teacher_id and
 * subject_teacher_id), so a plain follow-up query sidesteps needing an
 * embed-disambiguation hint.
 *
 * @param {string} startDate - 'YYYY-MM-DD', inclusive range start.
 * @param {string} endDate - 'YYYY-MM-DD', inclusive range end.
 */
async function loadSmileBoxRange(startDate, endDate) {
  const list = document.getElementById('smile-box-records-list')
  if (!list) return // section may have been switched away from mid-fetch

  const { data: entries, error } = await supabase
    .from('smile_box_entries')
    .select('id, author_teacher_id, subject_name, message, date')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error fetching Smile Box entries:', error)
    list.innerHTML = `<p class="error">${ADMIN_MESSAGES.smileBoxRecords.errorLoading(error)}</p>`
    return
  }

  if (!entries || entries.length === 0) {
    list.innerHTML = `<p>${ADMIN_MESSAGES.smileBoxRecords.noRecordsForRange}</p>`
    return
  }

  const authorIds = [...new Set(entries.map(e => e.author_teacher_id))]
  const { data: authors } = authorIds.length > 0
    ? await supabase.from('profiles').select('id, full_name').in('id', authorIds)
    : { data: [] }
  const authorNameById = new Map((authors || []).map(a => [a.id, a.full_name]))

  const dateGrouped = {}
  entries.forEach(e => {
    if (!dateGrouped[e.date]) dateGrouped[e.date] = []
    dateGrouped[e.date].push(e)
  })

  const dateBodies = Object.entries(dateGrouped).map(([date, dayEntries]) => {
    const rows = dayEntries.map(e => {
      const authorName = authorNameById.get(e.author_teacher_id) || ADMIN_MESSAGES.smileBoxRecords.unknownTeacher
      const subjectLine = e.subject_name
        ? ADMIN_MESSAGES.smileBoxRecords.aboutSubject(escapeHtml(e.subject_name))
        : ADMIN_MESSAGES.smileBoxRecords.generalLabel
      const safeMessage = escapeHtml(e.message).replace(/\n/g, '<br>')
      return `
        <div class="smile-box-card">
          <div class="smile-box-card-top">
            <span class="smile-box-subject">${subjectLine}</span>
          </div>
          <p class="smile-box-message">${safeMessage}</p>
          <p class="smile-box-author">${ADMIN_MESSAGES.smileBoxRecords.byTeacher(escapeHtml(toTitleCase(authorName)))}</p>
        </div>
      `
    }).join('')
    return [date, rows]
  })

  list.innerHTML = buildCollapsibleDateGroups(
    dateBodies,
    (date, body) => `<div class="records-date-group"><h4>${date}</h4>${body}</div>`
  )
}

/**
 * Volunteer Hours tab: review hours for non-grade teams (Yuvavani, Web
 * Team, etc.) flagged via `classes.tracks_volunteer_hours` -- see
 * data_import/23_volunteer_hours.sql and DECISIONS.md's "Volunteer Hours"
 * entry for the agreed design.
 *
 * By design this tab has no free-form "add a new entry" form -- entries
 * come from a team's teacher, via teacher.js's Log Hours tab (eligible to
 * Madhyamshishyas/Yuvashishyas students only, see
 * VOLUNTEER_ELIGIBLE_GRADES). The admin's job here is the same shape as
 * the Today tab's review modal is for attendance: Accept a submission
 * as-is, or Edit it (which also accepts it -- there's no separate
 * "override without accepting" state), or Delete a bad one outright.
 * Nothing here originates a brand-new entry for a student who was never
 * actually submitted.
 *
 * Picking a team from the dropdown shows (see renderVolunteerTeamContent):
 * a "Pending Review" section for anything awaiting a decision, then
 * accepted totals per student and a day-by-day activity log.
 *
 * @param {string} userId - Signed-in admin's id, stamped as `approved_by`
 *   on entries this tab accepts or edits.
 */
async function renderVolunteerHoursTab(userId) {
  const tabContent = document.getElementById('tab-content')

  const { data: teams, error: teamsError } = await supabase
    .from('classes')
    .select('id, name')
    .eq('tracks_volunteer_hours', true)

  if (teamsError) {
    console.error('Error loading volunteer teams:', teamsError)
    tabContent.innerHTML = `<p class="error">${ADMIN_MESSAGES.volunteerHours.couldntLoad(teamsError)}</p>`
    return
  }

  const sortedTeams = [...(teams || [])].sort((a, b) => a.name.localeCompare(b.name))
  const teamOptions = sortedTeams.map(t => `<option value="${t.id}">${t.name}</option>`).join('')

  // The pending list sits above the team picker and loads immediately,
  // across every team, so an admin sees exactly what needs review -- and
  // can act on it right there -- without first guessing which team to
  // select and scrolling down (see renderVolunteerPendingSection).
  tabContent.innerHTML = `
    <h4>${ADMIN_MESSAGES.volunteerHours.pendingHeading}</h4>
    <p class="volunteer-pending-hint">${ADMIN_MESSAGES.volunteerHours.pendingHint}</p>
    <div id="volunteer-pending-all"><p>${ADMIN_MESSAGES.volunteerHours.loadingPending}</p></div>

    <div class="section-header-row">
      <div class="volunteer-team-filter">
        <label>Team:
          <select id="volunteer-team-select">
            <option value="">${ADMIN_MESSAGES.volunteerHours.selectTeamPlaceholder}</option>
            ${teamOptions}
          </select>
        </label>
      </div>
    </div>
    <div id="volunteer-team-content">
      <p>${sortedTeams.length === 0 ? ADMIN_MESSAGES.volunteerHours.noTeamsYet : ADMIN_MESSAGES.volunteerHours.noTeamSelected}</p>
    </div>
  `

  document.getElementById('volunteer-team-select').addEventListener('change', (e) => {
    const classId = e.target.value
    if (!classId) {
      document.getElementById('volunteer-team-content').innerHTML = `<p>${ADMIN_MESSAGES.volunteerHours.noTeamSelected}</p>`
      return
    }
    renderVolunteerTeamContent(classId, userId)
  })

  // Wired ONCE here, on each persistent container -- both
  // renderVolunteerPendingSection and renderVolunteerTeamContent only ever
  // replace their own node's innerHTML (never the node itself), so these
  // delegated listeners keep working across every re-render (team switch,
  // accept/edit/delete) without ever double-binding. handleVolunteerEntryClick
  // reads each row's own data-class-id/data-team-name rather than the team
  // select's current value, since a click in the pending list can belong to
  // any team regardless of what's selected below.
  document.getElementById('volunteer-pending-all').addEventListener('click', (e) => handleVolunteerEntryClick(e, userId))
  document.getElementById('volunteer-team-content').addEventListener('click', (e) => handleVolunteerEntryClick(e, userId))

  renderVolunteerPendingSection(userId)
}

/**
 * Fetches and renders EVERY team's pending (unapproved) volunteer-hours
 * entries in one list, newest first -- the point being that an admin can
 * see and act on anything a teacher submitted without first selecting that
 * team from the picker below. Re-called after every accept/edit/delete
 * (from handleVolunteerEntryClick), same fetch-fresh approach as the rest
 * of this tab.
 *
 * @param {string} userId - Signed-in admin's id, stamped as `approved_by`.
 */
async function renderVolunteerPendingSection(userId) {
  const container = document.getElementById('volunteer-pending-all')
  if (!container) return // tab may have been switched away from mid-fetch

  const { data: entries, error } = await supabase
    .from('volunteer_hours')
    .select('id, student_id, date, hours, note, approved, class_id, students(full_name), classes(name)')
    .eq('approved', false)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error loading pending volunteer hours:', error)
    container.innerHTML = `<p class="error">${ADMIN_MESSAGES.volunteerHours.couldntLoad(error)}</p>`
    return
  }

  container.innerHTML = (entries || []).length > 0
    ? entries.map(e => buildVolunteerEntryRow(e, { showTeam: true })).join('')
    : `<p>${ADMIN_MESSAGES.volunteerHours.noPendingAnywhere}</p>`
}

/**
 * Fetches and renders one team's volunteer-hours content: accepted totals
 * per student, and a day-by-day activity log of accepted entries. Pending
 * (unapproved) entries for this team aren't shown here -- they're already
 * visible, and actionable, in the cross-team Pending Review section above
 * the team picker (see renderVolunteerPendingSection); this view is just
 * for browsing what's already been accepted for one team. Re-called
 * (rather than patched in place) after every accept/edit/delete so
 * everything always reflects exactly what's in the database, the same
 * fetch-fresh approach used elsewhere in this file (e.g. the Today tab's
 * review modal).
 *
 * @param {string} classId - The selected team's class id.
 * @param {string} userId - Signed-in admin's id -- see renderVolunteerHoursTab.
 */
async function renderVolunteerTeamContent(classId, userId) {
  const content = document.getElementById('volunteer-team-content')

  const { data: entries, error } = await supabase
    .from('volunteer_hours')
    .select('id, student_id, date, hours, note, approved, class_id, students(full_name), classes(name)')
    .eq('class_id', classId)
    .eq('approved', true)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error loading volunteer hours:', error)
    content.innerHTML = `<p class="error">${ADMIN_MESSAGES.volunteerHours.couldntLoad(error)}</p>`
    return
  }

  const approved = entries || []

  // Totals only count accepted hours -- a pending submission isn't
  // official yet, so it doesn't show up here until the admin actually
  // accepts (or edits, which also accepts) it. Same metric-row/metric-list
  // markup as the Records tab's summaries, reused rather than duplicated.
  const totalsByStudent = new Map()
  approved.forEach(e => {
    const name = toTitleCase(e.students?.full_name) || 'Unknown'
    totalsByStudent.set(name, (totalsByStudent.get(name) || 0) + Number(e.hours))
  })
  const totalsRows = [...totalsByStudent.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, hours]) => `
      <div class="metric-row">
        <span>${name}</span>
        <span class="metric-stat">${ADMIN_MESSAGES.volunteerHours.totalStat(Number(hours.toFixed(2)))}</span>
      </div>
    `)
    .join('')

  const activityRows = approved.map(e => buildVolunteerEntryRow(e)).join('')

  content.innerHTML = `
    <h4>${ADMIN_MESSAGES.volunteerHours.totalsHeading}</h4>
    <div class="metric-list">${totalsRows || `<p>${ADMIN_MESSAGES.volunteerHours.noTotalsYet}</p>`}</div>

    <h4>${ADMIN_MESSAGES.volunteerHours.activityHeading}</h4>
    <div id="volunteer-activity-list">${activityRows || `<p>${ADMIN_MESSAGES.volunteerHours.noActivityYet}</p>`}</div>
  `
}

/**
 * Builds one volunteer-hours entry row -- shared by the cross-team Pending
 * Review section and a single team's accepted activity log, since both
 * display the same shape and support the same actions (an unaccepted row
 * additionally gets an Accept button). Every value a click handler needs to
 * act on the row -- including its class_id and team name -- lives in its
 * own data-* attributes, so handleVolunteerEntryClick can act on any row
 * correctly regardless of which team (if any) happens to be selected in
 * the picker below, without a second fetch or keeping a parallel records
 * array around across re-renders.
 *
 * @param {object} e - `{id, student_id, date, hours, note, approved, class_id, students, classes}`.
 * @param {object} [opts]
 * @param {boolean} [opts.showTeam] - Prefix the row's meta line with its
 *   team name -- used by the cross-team pending list, where the team isn't
 *   otherwise implied by context (a single team's own activity log doesn't
 *   need this, since it's already scoped to that team).
 */
function buildVolunteerEntryRow(e, { showTeam = false } = {}) {
  // escapeHtml, not just a quote-only replace -- this note is free text a
  // teacher submitted (Log Hours tab), and was previously rendered
  // straight into innerHTML below with no escaping at all, a stored-XSS
  // gap every other free-text field in this app (lesson notes, Smile Box,
  // Kudos award notes) already closed via escapeHtml. Escaping it once
  // here covers both the attribute and the visible span below.
  const noteAttr = e.note ? escapeHtml(e.note) : ''
  const teamName = e.classes?.name || ''
  return `
    <div class="volunteer-entry-row" data-entry-id="${e.id}" data-student-id="${e.student_id}" data-class-id="${e.class_id}" data-team-name="${teamName}" data-date="${e.date}" data-hours="${e.hours}" data-note="${noteAttr}" data-approved="${e.approved}">
      <div class="volunteer-entry-main">
        <strong>${toTitleCase(e.students?.full_name)}</strong>
        <span>${showTeam && teamName ? `${teamName} · ` : ''}${e.date} · ${ADMIN_MESSAGES.volunteerHours.totalStat(Number(e.hours))}</span>
        ${e.note ? `<span class="volunteer-entry-note">${noteAttr}</span>` : ''}
      </div>
      <div class="volunteer-entry-actions">
        ${!e.approved ? `<button class="accept-volunteer-entry-btn">${ADMIN_MESSAGES.volunteerHours.acceptLabel}</button>` : ''}
        <button class="edit-volunteer-entry-btn">${ADMIN_MESSAGES.volunteerHours.editLabel}</button>
        <button class="delete-volunteer-entry-btn">${ADMIN_MESSAGES.volunteerHours.deleteLabel}</button>
      </div>
    </div>
  `
}

/**
 * Refreshes both volunteer-hours views after any accept/edit/delete: the
 * cross-team pending list always (an action anywhere can change what's
 * pending), and the currently-selected team's totals/activity if a team
 * happens to be selected below (harmless no-op re-fetch otherwise). Kept
 * as one helper so handleVolunteerEntryClick doesn't need to know or care
 * which view a click actually originated in.
 *
 * @param {string} userId
 */
function refreshVolunteerViews(userId) {
  renderVolunteerPendingSection(userId)
  const selectedTeamId = document.getElementById('volunteer-team-select')?.value
  if (selectedTeamId) renderVolunteerTeamContent(selectedTeamId, userId)
}

/**
 * Single delegated click handler for every volunteer-hours entry row,
 * shared by the cross-team pending list and a selected team's activity log
 * -- see renderVolunteerHoursTab for why this is wired once per container
 * rather than per-render. Handles Accept, Edit (swaps the row into inline
 * editable fields via buildVolunteerEntryEditRow), Save/Cancel out of edit
 * mode, and two-click-confirm Delete. Reads the affected team off the
 * row's own data-class-id/data-team-name (set by buildVolunteerEntryRow)
 * rather than the team picker's current value, since a row in the pending
 * list can belong to any team regardless of what's selected below.
 *
 * @param {MouseEvent} e
 * @param {string} userId - Signed-in admin's id, stamped as `approved_by`.
 */
async function handleVolunteerEntryClick(e, userId) {
  const row = e.target.closest('.volunteer-entry-row')
  if (!row) return
  const classId = row.dataset.classId
  const teamName = row.dataset.teamName || classId
  const entryId = row.dataset.entryId
  const studentName = row.querySelector('strong')?.textContent || row.dataset.studentId

  if (e.target.closest('.accept-volunteer-entry-btn')) {
    const { error } = await supabase.from('volunteer_hours').update({ approved: true, approved_by: userId }).eq('id', entryId)
    if (error) {
      showToast(ADMIN_MESSAGES.volunteerHours.couldntSave(error))
      return
    }
    showToast(ADMIN_MESSAGES.volunteerHours.accepted)
    logAudit(
      userId, 'admin', 'volunteer_hours.accepted', 'volunteer_hours', entryId,
      `Accepted ${row.dataset.hours} hrs for ${studentName} (${teamName}, ${row.dataset.date})`,
      { entry_id: entryId, class_id: classId, team_name: teamName, student_name: studentName, date: row.dataset.date, hours: Number(row.dataset.hours) }
    )
    refreshVolunteerViews(userId)
    return
  }

  if (e.target.closest('.edit-volunteer-entry-btn')) {
    row.innerHTML = buildVolunteerEntryEditRow(row)
    return
  }

  if (e.target.closest('.cancel-volunteer-edit-btn')) {
    // Discard in-place edits by just re-fetching -- simpler and more
    // correct than trying to reconstruct display mode from stale dataset
    // values, and consistent with how every other re-render in this tab
    // always goes back to the database rather than patching the DOM.
    refreshVolunteerViews(userId)
    return
  }

  if (e.target.closest('.save-volunteer-edit-btn')) {
    const date = row.querySelector('.volunteer-edit-date').value
    const hours = Number(row.querySelector('.volunteer-edit-hours').value)
    const note = row.querySelector('.volunteer-edit-note').value.trim() || null
    if (!hours || hours <= 0) {
      showToast(ADMIN_MESSAGES.volunteerHours.invalidHours)
      return
    }
    // Captured before the write, off the row's own (still-original) data-*
    // attributes -- see buildVolunteerEntryRow -- so the audit row below
    // can show what changed, not just what it changed to.
    const before = { date: row.dataset.date, hours: Number(row.dataset.hours), note: row.dataset.note || null, wasApproved: row.dataset.approved === 'true' }
    // Editing also accepts -- there's no separate "corrected but still
    // pending" state (see this tab's doc comment).
    const { error } = await supabase
      .from('volunteer_hours')
      .update({ date, hours, note, approved: true, approved_by: userId })
      .eq('id', entryId)
    if (error) {
      showToast(ADMIN_MESSAGES.volunteerHours.couldntSave(error))
      return
    }
    showToast(ADMIN_MESSAGES.volunteerHours.updated)
    logAudit(
      userId, 'admin', 'volunteer_hours.edited', 'volunteer_hours', entryId,
      `Edited ${studentName}'s entry (${teamName})${before.wasApproved ? '' : ' and accepted it'} -- ${before.hours} hrs on ${before.date} → ${hours} hrs on ${date}`,
      { entry_id: entryId, class_id: classId, team_name: teamName, student_name: studentName, before, after: { date, hours, note } }
    )
    refreshVolunteerViews(userId)
    return
  }

  const deleteBtn = e.target.closest('.delete-volunteer-entry-btn')
  if (deleteBtn) {
    // Two-click confirm -- same arm-then-confirm pattern as the Today
    // tab's Reject for Rework, since this app doesn't use native
    // confirm() dialogs anywhere.
    if (!deleteBtn.classList.contains('confirm-armed')) {
      deleteBtn.classList.add('confirm-armed')
      deleteBtn.textContent = ADMIN_MESSAGES.volunteerHours.deleteConfirmLabel
      return
    }
    const { error } = await supabase.from('volunteer_hours').delete().eq('id', entryId)
    if (error) {
      showToast(ADMIN_MESSAGES.volunteerHours.couldntDelete(error))
      deleteBtn.classList.remove('confirm-armed')
      deleteBtn.textContent = ADMIN_MESSAGES.volunteerHours.deleteLabel
      return
    }
    showToast(ADMIN_MESSAGES.volunteerHours.deleted)
    logAudit(
      userId, 'admin', 'volunteer_hours.deleted', 'volunteer_hours', entryId,
      `Deleted ${row.dataset.hours} hrs for ${studentName} (${teamName}, ${row.dataset.date})`,
      { entry_id: entryId, class_id: classId, team_name: teamName, student_name: studentName, date: row.dataset.date, hours: Number(row.dataset.hours), was_approved: row.dataset.approved === 'true' }
    )
    refreshVolunteerViews(userId)
  }
}

/**
 * Inline edit-mode markup for one entry row, replacing its display-mode
 * content in place -- see handleVolunteerEntryClick's Edit case. Reads
 * current values off the row's own data-* attributes (set by
 * buildVolunteerEntryRow) rather than needing a fresh fetch just to start
 * editing.
 *
 * @param {HTMLElement} row - The `.volunteer-entry-row` being edited.
 */
function buildVolunteerEntryEditRow(row) {
  const studentName = row.querySelector('strong')?.textContent || ''
  // row.dataset.note comes back from the DOM already HTML-decoded (that's
  // how data-* attributes work), i.e. it's the teacher's raw note text
  // again at this point -- re-escape before putting it back into a new
  // innerHTML string, or a `"` in the note breaks out of this attribute
  // the same way buildVolunteerEntryRow's note rendering did before that
  // was fixed.
  const noteValue = row.dataset.note ? escapeHtml(row.dataset.note) : ''
  return `
    <div class="volunteer-entry-main">
      <strong>${studentName}</strong>
      <input type="date" class="volunteer-edit-date" value="${row.dataset.date}" />
      <input type="number" class="volunteer-edit-hours" value="${row.dataset.hours}" step="0.25" min="0.25" />
      <input type="text" class="volunteer-edit-note" value="${noteValue}" placeholder="${ADMIN_MESSAGES.volunteerHours.notePlaceholder}" />
    </div>
    <div class="volunteer-entry-actions">
      <button class="save-volunteer-edit-btn">${ADMIN_MESSAGES.volunteerHours.saveLabel}</button>
      <button class="cancel-volunteer-edit-btn">${ADMIN_MESSAGES.volunteerHours.cancelEditButton}</button>
    </div>
  `
}

/**
 * Activity tab: a read-only, filterable view of audit_log (see
 * data_import/24_audit_log.sql and audit.js's logAudit) -- every decision
 * an admin or teacher has made that changed stored data, newest first,
 * with who did it, what they did (in their own words -- see each call
 * site's `summary`), and when. Defaults to the last 7 days so there's
 * normally something to see without having to touch the date filter
 * first; the same [start, end] range control as the Records tab, plus an
 * actor-role filter (this app only has the two roles).
 *
 * There's no edit or delete anywhere on this tab, on purpose -- see
 * data_import/24_audit_log.sql's RLS (no update/delete policy exists at
 * all). This is a record of what happened, not another editable table.
 */
async function renderActivityTab() {
  const tabContent = document.getElementById('tab-content')
  const today = todayStr()
  const weekAgo = new Date()
  weekAgo.setDate(weekAgo.getDate() - 6)
  const defaultStart = weekAgo.toISOString().slice(0, 10)

  tabContent.innerHTML = `
    <p class="drag-hint">${ADMIN_MESSAGES.activity.hint}</p>
    <div class="date-range">
      <label>From: <input type="date" id="activity-start-date" value="${defaultStart}" /></label>
      <label>To: <input type="date" id="activity-end-date" value="${today}" /></label>
      <label>Who: <select id="activity-role-filter">
        <option value="">${ADMIN_MESSAGES.activity.allActors}</option>
        <option value="admin">Admin</option>
        <option value="teacher">Teacher</option>
      </select></label>
      <button id="activity-filter-btn">Filter</button>
    </div>
    <div id="activity-list"></div>
  `

  document.getElementById('activity-filter-btn').addEventListener('click', () => {
    loadActivityRange(
      document.getElementById('activity-start-date').value,
      document.getElementById('activity-end-date').value,
      document.getElementById('activity-role-filter').value
    )
  })

  loadActivityRange(defaultStart, today, '')
}

/**
 * Fetches and renders audit_log rows within [startDate, endDate]
 * (inclusive, matched against created_at's date), optionally narrowed to
 * one actor role, newest first. Capped at 500 rows as a sanity limit --
 * narrowing the date range is the way to see more specific results within
 * a busy stretch, same as the Records tab's range filter.
 *
 * @param {string} startDate - 'YYYY-MM-DD', inclusive range start.
 * @param {string} endDate - 'YYYY-MM-DD', inclusive range end.
 * @param {string} roleFilter - '' (all), 'admin', or 'teacher'.
 */
async function loadActivityRange(startDate, endDate, roleFilter) {
  const list = document.getElementById('activity-list')

  // endDate's day is included in full, so the upper bound is midnight of
  // the *next* day -- a plain .lte('created_at', endDate) would compare
  // against midnight of endDate itself and silently drop everything from
  // later that same day.
  const endExclusive = new Date(`${endDate}T00:00:00Z`)
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1)

  let query = supabase
    .from('audit_log')
    .select('id, actor_role, action, entity_type, summary, created_at, profiles(full_name)')
    .gte('created_at', `${startDate}T00:00:00Z`)
    .lt('created_at', endExclusive.toISOString())
    .order('created_at', { ascending: false })
    .limit(500)
  if (roleFilter) query = query.eq('actor_role', roleFilter)

  const { data: rows, error } = await query

  if (error) {
    list.innerHTML = `<p class="error">${ADMIN_MESSAGES.activity.couldntLoad(error)}</p>`
    return
  }
  if (!rows || rows.length === 0) {
    list.innerHTML = `<p>${ADMIN_MESSAGES.activity.noActivityForRange}</p>`
    return
  }

  list.innerHTML = `
    <div class="metric-list">
      ${rows.map(r => `
        <div class="audit-log-row">
          <div class="audit-log-main">
            <span class="audit-log-summary">${escapeHtml(r.summary)}</span>
            <span class="audit-log-meta">${toTitleCase(r.profiles?.full_name) || 'Unknown'} · <span class="audit-log-role-badge audit-log-role-${r.actor_role}">${r.actor_role}</span></span>
          </div>
          <span class="audit-log-time">${formatActivityTimestamp(r.created_at)}</span>
        </div>
      `).join('')}
    </div>
  `
}

/**
 * Formats an audit_log row's created_at (an ISO UTC timestamp) for
 * display, pinned to Central Time for the same reason as the welcome
 * banner in teacher.js -- this app otherwise always talks about "today"
 * in Central Time (see calendar.js's todayStr), so the Activity tab's
 * timestamps should agree with that rather than the viewing device's own
 * timezone.
 *
 * @param {string} isoString
 * @returns {string} e.g. "Aug 31, 2026, 3:45 PM CDT".
 */
function formatActivityTimestamp(isoString) {
  return new Date(isoString).toLocaleString('en-US', {
    timeZone: 'America/Chicago',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  })
}
