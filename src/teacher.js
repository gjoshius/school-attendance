import { supabase } from './supabase.js'

export async function renderTeacherDashboard(container, userId) {
  // Fetch the teacher's assigned class with its students
  const { data: classes } = await supabase
    .from('classes')
    .select('*, students(*)')
    .eq('teacher_id', userId)

  const myClass = classes?.[0]

  // Show a fallback if no class is assigned
  if (!myClass) {
    container.innerHTML = '<p>No class assigned to you yet. Contact your admin.</p>'
    return
  }

  // Check if attendance was already submitted today
  const today = new Date().toISOString().split('T')[0]

  const { data: existingRecords } = await supabase
    .from('attendance')
    .select('id')
    .eq('class_id', myClass.id)
    .eq('date', today)

  const alreadySubmitted = existingRecords && existingRecords.length > 0

    // Render the tab navigation
  container.innerHTML = `
    <nav class="tabs">
      <button class="tab active" data-tab="attendance">Take Attendance</button>
      <button class="tab" data-tab="history">History</button>
    </nav>
    <div id="tab-content"></div>
  `

  // Set up tab click handlers
  const tabs = container.querySelectorAll('.tab')
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'))
      tab.classList.add('active')
      if (tab.dataset.tab === 'attendance') renderAttendanceForm(myClass, today, alreadySubmitted, userId)
      else renderTeacherHistory(myClass)
    })
  })

  renderAttendanceForm(myClass, today, alreadySubmitted, userId)
}

  function renderAttendanceForm(myClass, today, alreadySubmitted, userId) {
  const tabContent = document.getElementById('tab-content')
  // Block duplicate submissions for the same day
  if (alreadySubmitted) {
    tabContent.innerHTML = `
      <h3>${myClass.name} — ${today}</h3>
      <p class="success">Attendance already submitted for today.</p>
    `
    return
  }
  // Build a toggle row for each student
  const studentRows = (myClass.students || [])
    .map(s => `
      <div class="student-row" data-student-id="${s.id}">
        <span>${s.full_name}</span>
        <div class="status-toggle">
          <button class="toggle-btn present-btn active" data-status="present">Present</button>
          <button class="toggle-btn absent-btn" data-status="absent">Absent</button>
        </div>
      </div>
    `)
    .join('')
  // Render the form layout
  tabContent.innerHTML = `
    <h3>${myClass.name} — ${today}</h3>
    <div id="student-list">${studentRows}</div>
    <button id="submit-attendance">Submit Attendance</button>
    <p id="submit-message" class="hidden"></p>
  `
  // Make toggle buttons switch between Present and Absent
  tabContent.querySelectorAll('.student-row').forEach(row => {
    row.querySelectorAll('.toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        row.querySelectorAll('.toggle-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      })
    })
  })



  // Batch-insert all attendance records on submit
  document.getElementById('submit-attendance').addEventListener('click', async () => {
    const rows = tabContent.querySelectorAll('.student-row')
    const records = []

    rows.forEach(row => {
      const studentId = row.dataset.studentId
      const activeBtn = row.querySelector('.toggle-btn.active')
      const status = activeBtn ? activeBtn.dataset.status : 'present'
      records.push({
        student_id: studentId,
        class_id: myClass.id,
        date: today,
        status,
        marked_by: userId
      })
    })

    const { error } = await supabase.from('attendance').insert(records)
    const msg = document.getElementById('submit-message')
    if (error) {
      msg.textContent = 'Error: ' + error.message
      msg.className = 'error'
    } else {
      msg.textContent = 'Attendance submitted!'
      msg.className = 'success'
      document.getElementById('submit-attendance').disabled = true
    }
  })
}

async function renderTeacherHistory(myClass) {
  const tabContent = document.getElementById('tab-content')

  // Fetch attendance records for this class, newest first
  const { data: records } = await supabase
    .from('attendance')
    .select('date, status, students(full_name)')
    .eq('class_id', myClass.id)
    .order('date', { ascending: false })

  if (!records || records.length === 0) {
    tabContent.innerHTML = '<p>No attendance records yet.</p>'
    return
  }

  // Group records by date for display
  const grouped = {}
  records.forEach(r => {
    if (!grouped[r.date]) grouped[r.date] = []
    grouped[r.date].push(r)
  })

  let html = `<h3>Attendance History — ${myClass.name}</h3>`
  for (const [date, entries] of Object.entries(grouped)) {
    html += `<h4>${date}</h4><ul>`
    entries.forEach(entry => {
      const statusClass = entry.status === 'present' ? 'present' : 'absent'
      html += `<li class="${statusClass}">${entry.students?.full_name} — ${entry.status}</li>`
    })
    html += '</ul>'
  }

  tabContent.innerHTML = html
}


