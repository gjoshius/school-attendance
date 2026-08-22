import { supabase } from './supabase.js'

export async function renderAdminDashboard(container) {
  // Render tab navigation for admin sections
  container.innerHTML = `
    <nav class="tabs">
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
      tabs.forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      const tabName = tab.dataset.tab
      if (tabName === 'classes') renderClassesTab()
      else if (tabName === 'students') renderStudentsTab()
      else if (tabName === 'records') renderRecordsTab()
    })
  })

  // Show the Classes tab by default
  renderClassesTab()
}

async function renderClassesTab() {
  const tabContent = document.getElementById('tab-content')

  // Fetch all teachers for the dropdown
  const { data: teachers } = await supabase
    .from('profiles')
    .select('id, full_name')
    .eq('role', 'teacher')

  // Fetch existing classes with teacher names
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
    e.preventDefault()
    const name = document.getElementById('class-name').value
    const teacherId = document.getElementById('teacher-select').value

    await supabase.from('classes').insert({ name, teacher_id: teacherId })
    renderClassesTab()
  })
}

async function renderStudentsTab() {
  const tabContent = document.getElementById('tab-content')

  // Fetch all classes for the dropdown
  const { data: classes } = await supabase.from('classes').select('id, name')

  // Fetch all students with their class names
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
    e.preventDefault()
    const fullName = document.getElementById('student-name').value
    const classId = document.getElementById('student-class').value

    await supabase.from('students').insert({ full_name: fullName, class_id: classId })
    renderStudentsTab()
  })
}

async function renderRecordsTab() {
  const tabContent = document.getElementById('tab-content')
  const today = new Date().toISOString().split('T')[0]

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

  document.getElementById('filter-btn').addEventListener('click', () => {
    const startDate = document.getElementById('start-date').value
    const endDate = document.getElementById('end-date').value
    loadRecordsRange(startDate, endDate)
  })

  loadRecordsRange(today, today)
}

async function loadRecordsRange(startDate, endDate) {
  const summaryCards = document.getElementById('summary-cards')
  const recordsList = document.getElementById('records-list')

  // Query attendance within the date range
  const { data: records } = await supabase
    .from('attendance')
    .select('date, status, students(full_name), classes(name)')
    .gte('date', startDate)
    .lte('date', endDate)
    .order('date', { ascending: false })

  if (!records || records.length === 0) {
    summaryCards.innerHTML = ''
    recordsList.innerHTML = '<p>No records for this date range.</p>'
    return
  }

  // Track per-class totals and group records by date
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

  // Render detailed records grouped by date and class
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
