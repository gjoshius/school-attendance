import { supabase } from './supabase.js'
import { renderLogin } from './auth.js'
import { renderAdminDashboard } from './admin.js'
import { renderTeacherDashboard } from './teacher.js'

// Cache DOM references
const mainContent = document.getElementById('main-content')
const signOutBtn = document.getElementById('sign-out-btn')

// Fetch the user's role from the profiles table
async function getUserRole(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  return data?.role
}

// Route user to the correct view based on their role
async function handleAuthState(session) {
  if (!session) {
    signOutBtn.classList.add('hidden')
    renderLogin(mainContent)
    return
  }

  signOutBtn.classList.remove('hidden')
  const role = await getUserRole(session.user.id)

  if (role === 'admin') {
    renderAdminDashboard(mainContent, session.user.id)
  } else if (role === 'teacher') {
    renderTeacherDashboard(mainContent, session.user.id)
  }
}

// Sign out when the button is clicked
signOutBtn.addEventListener('click', async () => {
  await supabase.auth.signOut({ scope: 'local' })
})

// Listen for login/logout events and route accordingly
supabase.auth.onAuthStateChange((event, session) => {
  handleAuthState(session)
})