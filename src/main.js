/**
 * main.js
 *
 * App entry point (loaded via <script type="module"> in index.html).
 *
 * Responsibilities:
 *  - Watch the Supabase auth session and re-render the page whenever it
 *    changes (sign in, sign out, token refresh).
 *  - Look up the signed-in user's role and route them to the matching
 *    dashboard: admin, teacher, or the login screen if not signed in.
 */

import { supabase } from './supabase.js'
import { renderLogin } from './auth.js'
import { renderAdminDashboard } from './admin.js'
import { renderTeacherDashboard } from './teacher.js'

// Cache DOM references
const mainContent = document.getElementById('main-content')
const signOutBtn = document.getElementById('sign-out-btn')

// Create toast container
const toastContainer = document.createElement('div')
toastContainer.id = 'toast-container'
document.body.appendChild(toastContainer)

// Global toast function
window.showToast = function showToast(message) {
  const toast = document.createElement('div')
  toast.className = 'toast'
  toast.textContent = message
  toastContainer.appendChild(toast)

  // Trigger slide-in animation
  requestAnimationFrame(() => toast.classList.add('visible'))

  // Auto-dismiss after 4 seconds
  setTimeout(() => {
    toast.classList.remove('visible')
    toast.addEventListener('transitionend', () => toast.remove())
  }, 4000)
}

/**
 * Look up a user's role from the `profiles` table.
 *
 * @param {string} userId - Supabase auth user id.
 * @returns {Promise<string|undefined>} The role (e.g. 'admin' | 'teacher'),
 *   or undefined if no matching profile row exists.
 */
async function getUserRole(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()
  return data?.role
}

/**
 * Render the correct view for the current auth session:
 *  - No session -> show the login form and hide the sign-out button.
 *  - Session present -> look up the user's role and render their dashboard.
 *
 * @param {import('@supabase/supabase-js').Session|null} session
 */
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
  // NOTE: a profile with no recognized role (or missing profile row)
  // currently renders nothing — consider adding an explicit fallback view.
}

// Sign out when the button is clicked.
// { scope: 'local' } only clears this browser's session (not other devices).
signOutBtn.addEventListener('click', async () => {
  // Clean up any open Realtime subscription so it doesn't keep running
  // (and consuming a connection) after the admin signs out.
  if (window._attendanceChannel) {
    supabase.removeChannel(window._attendanceChannel)
    window._attendanceChannel = null
  }
  await supabase.auth.signOut({ scope: 'local' })
})

// Listen for login/logout/token-refresh events and re-route accordingly.
// This fires once immediately on page load with the current session (or
// null), so it also handles the initial render.
supabase.auth.onAuthStateChange((event, session) => {
  handleAuthState(session)
})
