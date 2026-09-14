/**
 * set-password.js
 *
 * Renders the "Set a new password" form shown when someone arrives via a
 * Supabase Auth recovery link -- either accepting their first-time invite
 * (see data_import/invite_teachers.mjs) or a "Forgot password?" reset
 * (see auth.js). Supabase fires the same PASSWORD_RECOVERY event for both
 * cases, so one form handles both; main.js renders this instead of the
 * normal dashboard whenever that event fires.
 */

import { supabase } from './supabase.js'
import { validatePassword } from './password-rules.js'
import { passwordFieldHtml, wirePasswordToggles } from './password-toggle.js'
import { PASSWORD_RULES } from './config.js'

/**
 * @param {HTMLElement} container - DOM element to render the form into.
 */
export function renderSetPassword(container) {
  container.innerHTML = `
    <div class="login-form">
      <h2>Set Your Password</h2>
      <form id="set-password-form">
        ${passwordFieldHtml('new-password', `New password (min ${PASSWORD_RULES.minLength} characters)`)}
        ${passwordFieldHtml('confirm-password', 'Confirm password')}
        <button type="submit">Save Password</button>
        <p id="set-password-error" class="error hidden"></p>
      </form>
    </div>
  `

  wirePasswordToggles(container)

  document.getElementById('set-password-form').addEventListener('submit', async (e) => {
    e.preventDefault() // stop the browser's default full-page form submit

    const password = document.getElementById('new-password').value
    const confirmPassword = document.getElementById('confirm-password').value
    const errorEl = document.getElementById('set-password-error')

    // Same rules as auth.js's "Set / Reset Password" form -- see
    // password-rules.js.
    const validationError = validatePassword(password, confirmPassword)
    if (validationError) {
      errorEl.textContent = validationError
      errorEl.classList.remove('hidden')
      return
    }

    // Updates the password on the temporary recovery session Supabase
    // established from the invite/reset link. On success this also fires
    // a fresh auth state change (USER_UPDATED), which main.js's
    // onAuthStateChange listener falls through to handleAuthState() for --
    // routing the now fully-signed-in teacher to their dashboard.
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.remove('hidden')
    }
  })
}
