/**
 * admin.js
 *
 * Renders the admin dashboard: a tabbed view for managing classes,
 * students, and browsing attendance records.
 *
 * Tabs:
 *  - Today: live status board showing which classes have submitted
 *    attendance today, updating in real time as teachers submit.
 *  - Classes: create classes and assign a teacher to each one.
 *  - Students: add students and assign them to a class.
 *  - Records: view attendance history with per-class summaries,
 *    filterable by date range.
 */

import { supabase } from './supabase.js'

/**
 * Entry point for the admin view. Renders the tab navigation and wires up
 * tab switching, then shows the Classes tab by default.
 *
 * @param {HTMLElement} container - DOM element to render the dashboard into.
 */
export async function renderAdminDashboard(container) {
  // Render tab navigation for admin sections
  container.innerHTML = `
    <nav class="tabs">
      <button class="tab" data-tab="today">Today</button>
      <button class="tab active" data-tab="classes">Classes</button>
      <button class="tab" data-tab="students">Students</button>
      <button class="tab" data-tab="records">Records</button>
    </nav>
    <div id="tab-content"></div>
  `

  // Add click handlers to switch between tabs
  const tabs = container.querySelectorAll('.tab')
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Clean up the Realtime subscription when leaving the Today tab, so
      // switching tabs repeatedly doesn't pile up open subscriptions.
      if (window._attendanceChannel) {
        supabase.removeChannel(window._attendanceChannel)
        window._attendanceChannel = null
      }

      // Toggle the "active" styling to the clicked tab only
      tabs.forEach(t => t.classList.remove('active'))
      tab.classList.add('active')

      const tabName = tab.dataset.tab
      if (tabName === 'today') renderTodayTab()
      else if (tabName === 'classes') renderClassesTab()
      else if (tabName === 'students') renderStudentsTab()
      else if (tabName === 'records') renderRecordsTab()
    })
  })

  // Show the Classes tab by default
  renderClassesTab()
}

/**
 * Today tab: a live status board of every class showing whether its
 * attendance has been submitted today, updating in real time as teachers
 * submit via a Supabase Realtime subscription.
 */
async function renderTodayTab() {
  const tabContent = document.getElementById('tab-content')
  const today = new Date().toISOString().split('T')[0] // 'YYYY-MM-DD'

  // Fetch all classes with their assigned teacher names
  const { data: classes } = await supabase
    .from('classes')
    .select('id, name, profiles(full_name)')

  // Fetch attendance records already submitted today
  const { data: todayRecords } = await supabase
    .from('attendance')
    .select('class_id')
    .eq('date', today)

  // Collect the IDs of classes that already submitted
  const submittedClassIds = new Set((todayRecords || []).map(r => r.class_id))

  // Build a status card for each class
  const cards = (classes || [])
    .map(c => {
      const submitted = submittedClassIds.has(c.id)
      return `
        <div class="status-card ${submitted ? 'submitted' : 'waiting'}" data-class-id="${c.id}">
          <strong>${c.name}</strong>
          <span class="teacher-name">${c.profiles?.full_name || 'Unassigned'}</span>
          <span class="status-badge">${submitted ? 'Submitted' : 'Waiting'}</span>
        </div>
      `
    })
    .join('')

  // Render the status board into the tab content area
  tabContent.innerHTML = `
    <h3>Today's Attendance — ${today}</h3>
    <div id="status-board" class="status-board">
      ${cards || '<p>No classes created yet.</p>'}
    </div>
    <div id="toast-container"></div>
  `

  // Clean up any previous subscription before opening a new one (e.g. if
  // this tab is re-rendered without navigating away first)
  if (window._attendanceChannel) {
    supabase.removeChannel(window._attendanceChannel)
  }

  // Subscribe to new attendance inserts and flip the matching card live
  window._attendanceChannel = supabase
    .channel('attendance-today')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'attendance' },
      (payload) => {
        // Ignore inserts for other dates (e.g. a backfilled record)
        if (payload.new.date !== today) return

        const classId = payload.new.class_id
        const card = tabContent.querySelector(`.status-card[data-class-id="${classId}"]`)
        if (card && card.classList.contains('waiting')) {
          card.classList.remove('waiting')
          card.classList.add('submitted')
          card.querySelector('.status-badge').textContent = 'Submitted'

          // Find the class name for the toast
          const className = card.querySelector('strong').textContent
          showToast(`${className} attendance submitted!`)
        }
      }
    )
    .subscribe()
}

/**
 * Briefly show a toast notification in the Today tab's toast container.
 * Silently does nothing if the container isn't on screen (e.g. the user
 * has already navigated to another tab).
 *
 * @param {string} message - Text to display in the toast.
 */
function showToast(message) {
  const container = document.getElementById('toast-container')
  if (!container) return

  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  container.appendChild(toast)

  setTimeout(() => toast.remove(), 3000)
}

/**
 * Classes tab: lists existing classes and provides a form to create a new
 * one, assigning it to a teacher.
 */
async function renderClassesTab() {
  const tabContent = document.getElementById('tab-content')

  // Fetch all teachers for the dropdown
  const { data: teachers } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'teacher')

  // Fetch existing classes with teacher names (via the `profiles` relation)
  const { data: classes } = await supabase
    .from('classes')
    .select('*, profiles(full_name)')

  // Build dropdown options from teacher list
  const teacherOptions = (teachers || [])
    .map(t => `<option value="${t.id}">${t.full_name}</option>`)
    .join('')

  // Build the class list HTML
  const classList = (classes || [])
    .map(c => `<li>${c.name} — ${c.profiles?.full_name || 'Unassigned'}</li>`)
    .join('')

  // Render the form and existing classes list
  tabContent.innerHTML = `
    <h3>Create Class</h3>
    <form id="class-form">
      <input type="text" id="class-name" placeholder="Class name" required />
      <select id="teacher-select" required>
        <option value="">Select teacher</option>
        ${teacherOptions}
      </select>
      <button type="submit">Create Class</button>
    </form>
    <h3>Existing Classes</h3>
    <ul id="class-list">${classList || '<li>No classes yet</li>'}</ul>
  `

  // Handle new class creation
  document.getElementById('class-form').addEventListener('submit', async (e) => {
    e.preventDefault() // stop the browser's default full-page form submit
    const name = document.getElementById('class-name').value
    const teacherId = document.getElementById('teacher-select').value

    await supabase.from('classes').insert({ name, teacher_id: teacherId })
    // Re-render the tab so the newly created class shows up in the list
    renderClassesTab()
  })
}

/**
 * Students tab: lists all students (with their class) and provides a form
 * to add a new student to a class.
 */
async function renderStudentsTab() {
  const tabContent = document.getElementById('tab-content')

  // Fetch all classes for the dropdown
  const { data: classes } = await supabase.from('classes').select('id, name')

  // Fetch all students with their class names (via the `classes` relation)
  const { data: students } = await supabase
    .from('students')
    .select('*, classes(name)')
    .order('class_id')

  // Build dropdown options from class list
  const classOptions = (classes || [])
    .map(c => `<option value="${c.id}">${c.name}</option>`)
    .join('')

  // Build the student list HTML
  const studentList = (students || [])
    .map(s => `<li>${s.full_name} — ${s.classes?.name}</li>`)
    .join('')

  // Render the student form and existing students
  tabContent.innerHTML = `
    <h3>Add Student</h3>
    <form id="student-form">
      <input type="text" id="student-name" placeholder="Student name" required />
      <select id="student-class" required>
        <option value="">Select class</option>
        ${classOptions}
      </select>
      <button type="submit">Add Student</button>
    </form>
    <h3>All Students</h3>
    <ul id="student-list">${studentList || '<li>No students yet</li>'}</ul>
  `

  // Handle new student form submission
  document.getElementById('student-form').addEventListener('submit', async (e) => {
    e.preventDefault() // stop the browser's default full-page form submit
    const fullName = document.getElementById('student-name').value
    const classId = document.getElementById('student-class').value

    await supabase.from('students').insert({ full_name: fullName, class_id: classId })
    // Re-render the tab so the newly added student shows up in the list
    renderStudentsTab()
  })
}

/**
 * Records tab: shows attendance summaries and a detailed, filterable log
 * grouped by date and class. Defaults to showing just today's records.
 */
async function renderRecordsTab() {
  const tabContent = document.getElementById('tab-content')
  const today = new Date().toISOString().split('T')[0] // 'YYYY-MM-DD'

  tabContent.innerHTML = `
    <h3>Attendance Records</h3>
    <div class="date-range">
      <label>From: <input type="date" id="start-date" value="${today}" /></label>
      <label>To: <input type="date" id="end-date" value="${today}" /></label>
      <button id="filter-btn">Filter</button>
    </div>
    <div id="summary-cards"></div>
    <div id="records-list"></div>
  `

  // Re-query and re-render when the user picks a new date range
  document.getElementById('filter-btn').addEventListener('click', () => {
    const startDate = document.getElementById('start-date').value
    const endDate = document.getElementById('end-date').value
    loadRecordsRange(startDate, endDate)
  })

  // Initial load: just today's records
  loadRecordsRange(today, today)
}

/**
 * Fetch attendance records within [startDate, endDate] (inclusive) and
 * render both the per-class summary cards and the detailed, grouped list.
 *
 * @param {string} startDate - 'YYYY-MM-DD', inclusive range start.
 * @param {string} endDate - 'YYYY-MM-DD', inclusive range end.
 */
async function loadRecordsRange(startDate, endDate) {
  const summaryCards = document.getElementById('summary-cards')
  const recordsList = document.getElementById('records-list')

  // Query attendance within the date range
  const { data: records, error } = await supabase
    .from('attendance')
    .select('date, status, students(full_name), classes(name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  if (error) {
    console.error('Error fetching records:', error)
    summaryCards.innerHTML = '<p class="error">Error loading summaries.</p>'
    recordsList.innerHTML = '<p class="error">Error loading records.</p>'
    return
  }

  if (!records || records.length === 0) {
    summaryCards.innerHTML = ''
    recordsList.innerHTML = '<p>No records for this date range.</p>'
    return
  }

  // Track per-class totals (for the summary cards) and group records by
  // date then class (for the detailed list) in a single pass.
  const classSummary = {}
  const dateGrouped = {}
  records.forEach(r => {
    const className = r.classes?.name || 'Unknown'

    if (!classSummary[className]) classSummary[className] = { present: 0, total: 0 }
    classSummary[className].total++
    if (r.status === 'present') classSummary[className].present++

    const dateKey = r.date
    if (!dateGrouped[dateKey]) dateGrouped[dateKey] = {}
    if (!dateGrouped[dateKey][className]) dateGrouped[dateKey][className] = []
    dateGrouped[dateKey][className].push(r)
  })

  // Render summary cards with attendance percentages
  let summaryHtml = '<div class="summary-grid">'
  for (const [className, counts] of Object.entries(classSummary)) {
    const pct = Math.round((counts.present / counts.total) * 100)
    summaryHtml += `
      <div class="summary-card">
        <strong>${className}</strong>
        <span class="pct">${pct}% present</span>
        <span class="detail">${counts.present}/${counts.total}</span>
      </div>
    `
  }
  summaryHtml += '</div>'
  summaryCards.innerHTML = summaryHtml

  // Render detailed records grouped by date, then by class within each date
  let detailHtml = ''
  for (const [date, classes] of Object.entries(dateGrouped)) {
    detailHtml += `<h4>${date}</h4>`
    for (const [className, entries] of Object.entries(classes)) {
      detailHtml += `<p><strong>${className}</strong></p><ul>`
      entries.forEach(entry => {
        const statusClass = entry.status === 'present' ? 'present' : 'absent'
        detailHtml += `<li class="${statusClass}">${entry.students?.full_name} — ${entry.status}</li>`
      })
      detailHtml += '</ul>'
    }
  }
  recordsList.innerHTML = detailHtml
}
