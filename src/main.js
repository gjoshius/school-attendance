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
import { renderSetPassword } from './set-password.js'
import { APP_NAME, APP_LOGO_URL, APP_FOOTER_TEXT, PENDING_SETUP_MESSAGE } from './config.js'

// Cache DOM references
const mainContent = document.getElementById('main-content')
const signOutBtn = document.getElementById('sign-out-btn')

// A recovery link -- either a first-time invite (data_import/invite_teachers.mjs)
// or a "Forgot password?" reset (auth.js) -- lands back here with
// `type=recovery` in the URL hash (this app's Supabase client uses the
// default implicit flow, so the token and type arrive as a hash fragment,
// not a query string). Deliberately NOT relying solely on Supabase firing a
// PASSWORD_RECOVERY auth event to detect this, which multiple confirmed
// Supabase issues report as unreliable (can fire SIGNED_IN instead,
// especially with an existing session already in the browser -- see
// https://github.com/orgs/supabase/discussions/14181).
//
// Also NOT relying on a plain JS variable holding this for the page's
// whole lifetime, which turned out not to be enough on its own: on mobile
// in particular, the recovery link can trigger more than one page load in
// the same browser tab before the user ever reaches the password form --
// e.g. an email app's in-app browser doing its own "verify, then redirect
// to a clean URL" hop. Supabase's own hash cleanup (history.replaceState)
// runs on that first load, so a SECOND load in the same tab often no
// longer has `type=recovery` in the URL at all -- even though the
// recovery session it already established is sitting right there in
// localStorage (persistSession defaults to true), which then just looks
// like a completely normal, already-signed-in session to any code that
// only checked the URL once. sessionStorage survives a reload within the
// same tab (unlike a plain variable), so the flag below is written the
// moment a recovery link is ever detected and stays put across any such
// reload, not just the first one.
const RECOVERY_FLAG_KEY = 'htyg_password_recovery_in_progress'
if (window.location.hash.includes('type=recovery')) {
  sessionStorage.setItem(RECOVERY_FLAG_KEY, '1')
}
// handleAuthState is bypassed entirely below whenever this is true,
// regardless of which event actually fires and regardless of any existing
// session -- so someone already signed in on this browser (e.g. an admin
// testing a reset link), or a session left over from an in-app-browser
// reload, can never get silently routed straight to a dashboard instead of
// the "Set Your Password" form. Cleared only once the password is actually
// saved (see the USER_UPDATED check below), letting normal routing resume
// from that point on.
let isPasswordRecoveryLink = sessionStorage.getItem(RECOVERY_FLAG_KEY) === '1'

// Apply branding from config.js -- the tab title and header markup in
// index.html carry static fallback text/values so the page never looks
// broken before this runs, but this is what actually keeps them in sync
// with src/config.js. Change branding there, not in index.html.
document.title = APP_NAME
document.getElementById('app-title').textContent = APP_NAME
document.getElementById('app-logo').src = APP_LOGO_URL
document.getElementById('app-footer').textContent = APP_FOOTER_TEXT

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
 * Whether this user is *also* personally assigned to teach a class (i.e.
 * has a class_teachers row), independent of their `profiles.role`. Used to
 * give an admin who also teaches (e.g. someone made admin via
 * data_import/34_promote_vidya_to_admin.sql, but who was already a
 * class_teachers member from before) access to their own teacher
 * dashboard too -- see renderDualRoleShell.
 *
 * @param {string} userId - Supabase auth user id.
 * @returns {Promise<boolean>}
 */
async function isAlsoAssignedTeacher(userId) {
  const { data } = await supabase
    .from('class_teachers')
    .select('class_id')
    .eq('teacher_id', userId)
    .limit(1)
  return !!(data && data.length > 0)
}

/**
 * Cleans up every open Realtime subscription this app can have running:
 * the admin Today tab's attendance-submission channel
 * (window._attendanceChannel), its teacher-presence viewer
 * (window._teacherPresenceViewerChannel -- see admin.js's renderTodayTab),
 * and a teacher's own presence broadcast while the attendance form is open
 * (window._teacherPresenceChannel -- see teacher.js's
 * trackTeacherPresence/cleanupTeacherPresenceChannel). Needed any time a
 * dashboard is unmounted from underneath itself -- normally that's
 * admin.js's/teacher.js's own tab-switch handling (switching within the
 * SAME dashboard), or this file's sign-out handler below, but
 * renderDualRoleShell below unmounts a WHOLE dashboard (not just a tab
 * within it) when an admin who also teaches switches between "Admin" and
 * "My Class", so it needs the same cleanup.
 */
function cleanupRealtimeChannels() {
  ;['_attendanceChannel', '_teacherPresenceViewerChannel', '_teacherPresenceChannel'].forEach(key => {
    if (window[key]) {
      supabase.removeChannel(window[key])
      window[key] = null
    }
  })
}

/**
 * For an admin who is also personally assigned to teach a class: renders a
 * small switcher above the dashboard so they can flip between the full
 * admin dashboard and their own teacher dashboard (to submit attendance or
 * write a lesson note for their class) using a single login -- instead of
 * needing a second account, or losing teacher access entirely the moment
 * they're made admin (profiles.role is a single value; see main.js's
 * module doc and data_import/34_promote_vidya_to_admin.sql).
 *
 * Each view fully owns the sub-container it's given (same as when either
 * dashboard is mounted directly into #main-content) -- this function only
 * decides which one is currently mounted, same relationship main.js has
 * to the dashboards themselves.
 *
 * @param {HTMLElement} container - Empty element to render into.
 * @param {string} userId - Supabase auth user id of the signed-in admin.
 */
function renderDualRoleShell(container, userId) {
  container.innerHTML = `
    <div class="role-switcher">
      <button type="button" class="role-switch-btn active" id="role-switch-admin">Admin</button>
      <button type="button" class="role-switch-btn" id="role-switch-teacher">My Class</button>
    </div>
    <div id="role-switch-content"></div>
  `

  const contentEl = document.getElementById('role-switch-content')
  const adminBtn = document.getElementById('role-switch-admin')
  const teacherBtn = document.getElementById('role-switch-teacher')

  const showAdmin = () => {
    cleanupRealtimeChannels()
    adminBtn.classList.add('active')
    teacherBtn.classList.remove('active')
    renderAdminDashboard(contentEl, userId)
  }

  const showTeacher = () => {
    cleanupRealtimeChannels()
    teacherBtn.classList.add('active')
    adminBtn.classList.remove('active')
    // Always the full teacher view here, never the restricted assistant
    // one -- this switcher is for an admin who also happens to teach a
    // class (profiles.role = 'admin'), not for the assistant role at all.
    renderTeacherDashboard(contentEl, userId, 'teacher')
  }

  adminBtn.addEventListener('click', showAdmin)
  teacherBtn.addEventListener('click', showTeacher)

  // Admin view first -- it's what an admin needs to check first on login
  // (see renderAdminDashboard's own doc comment), same default as before
  // this switcher existed.
  showAdmin()
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
    const alsoTeaches = await isAlsoAssignedTeacher(session.user.id)
    if (alsoTeaches) {
      renderDualRoleShell(mainContent, session.user.id)
    } else {
      renderAdminDashboard(mainContent, session.user.id)
    }
  } else if (role === 'teacher' || role === 'assistant') {
    // Same dashboard renders both -- renderTeacherDashboard itself trims
    // the tab set (no Log Hours, no program-wide attendance access) when
    // role is 'assistant'. See src/teacher.js's own doc comment on that.
    renderTeacherDashboard(mainContent, session.user.id, role)
  } else {
    // Signed in, but no matching `profiles` row (or one with no
    // recognized role) yet -- happens right after accepting an invite,
    // before data_import/08c_sync_teacher_profiles.sql has been run to
    // create their profile. Previously this rendered nothing at all, which
    // looked like a broken page; show what's actually going on instead.
    mainContent.innerHTML = `
      <div class="pending-setup-message">
        <h2>${PENDING_SETUP_MESSAGE.heading}</h2>
        <p>${PENDING_SETUP_MESSAGE.body}</p>
      </div>
    `
  }
}

// Sign out when the button is clicked.
// { scope: 'local' } only clears this browser's session (not other devices).
signOutBtn.addEventListener('click', async () => {
  // Clean up any open Realtime subscriptions so none of them keep running
  // (and consuming a connection) after signing out.
  cleanupRealtimeChannels()
  await supabase.auth.signOut({ scope: 'local' })
})

// Listen for login/logout/token-refresh events and re-route accordingly.
// This fires once immediately on page load with the current session (or
// null), so it also handles the initial render.
supabase.auth.onAuthStateChange((event, session) => {
  // A password reset or first-time invite link (see auth.js and
  // data_import/invite_teachers.mjs) lands back here with a temporary
  // session -- show the "set new password" form instead of routing
  // straight to a dashboard. Checked two ways, not just the event name
  // (see isPasswordRecoveryLink's own doc comment above for why the event
  // alone isn't trustworthy): Supabase's own PASSWORD_RECOVERY event when
  // it does fire, OR the URL itself having said `type=recovery` at load
  // time, whichever case applies.
  if (event === 'PASSWORD_RECOVERY' || isPasswordRecoveryLink) {
    signOutBtn.classList.add('hidden')
    renderSetPassword(mainContent)
    return
  }

  // Saving a new password (set-password.js) fires USER_UPDATED -- the one
  // event that actually means this recovery flow finished, so this is the
  // only place isPasswordRecoveryLink gets cleared (both the in-memory
  // flag and the sessionStorage one behind it -- see that flag's own doc
  // comment above for why both exist), letting normal routing resume from
  // here on, including across any later reload in this same tab.
  if (event === 'USER_UPDATED') {
    isPasswordRecoveryLink = false
    sessionStorage.removeItem(RECOVERY_FLAG_KEY)
  }

  handleAuthState(session)
})
