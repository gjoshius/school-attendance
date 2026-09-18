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
 * @param {() => void|Promise<void>} [onSuccess] - Called right after the
 *   password is saved successfully. main.js passes a callback that clears
 *   its recovery-flag state and routes into the app itself -- see the
 *   comment on the updateUser call below for why this can't just wait on
 *   Supabase's own auth event to do that.
 */
export function renderSetPassword(container, onSuccess) {
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
    const submitBtn = e.target.querySelector('button[type="submit"]')

    // Same rules as auth.js's "Set / Reset Password" form -- see
    // password-rules.js.
    const validationError = validatePassword(password, confirmPassword)
    if (validationError) {
      errorEl.textContent = validationError
      errorEl.classList.remove('hidden')
      return
    }

    errorEl.classList.add('hidden')
    // Guard against a double-tap/double-submit on mobile firing this twice
    // while the first call is still in flight.
    submitBtn.disabled = true
    submitBtn.textContent = 'Saving...'

    // Updates the password on the temporary recovery session Supabase
    // established from the invite/reset link.
    const { error } = await supabase.auth.updateUser({ password })

    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.remove('hidden')
      submitBtn.disabled = false
      submitBtn.textContent = 'Save Password'
      return
    }

    // Route into the app ourselves instead of waiting on Supabase to fire
    // USER_UPDATED and letting main.js's onAuthStateChange listener catch
    // it. That event is the same kind of unreliable as PASSWORD_RECOVERY
    // (see main.js's isPasswordRecoveryLink comment) -- on some
    // SDK/browser combinations it simply never arrives, which left mobile
    // users stuck staring at this exact form after a successful save with
    // no error and no way forward ("not allowing login post setting the
    // password"). main.js's listener still handles USER_UPDATED too, if it
    // does fire -- calling onSuccess here is a direct, guaranteed path
    // that doesn't depend on it.
    if (onSuccess) {
      await onSuccess()
    }
  })
}
