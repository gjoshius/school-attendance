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
  await supabase.auth.signOut({ scope: 'local' })
})

// Listen for login/logout/token-refresh events and re-route accordingly.
// This fires once immediately on page load with the current session (or
// null), so it also handles the initial render.
supabase.auth.onAuthStateChange((event, session) => {
  handleAuthState(session)
})
