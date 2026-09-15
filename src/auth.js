/**
 * auth.js
 *
 * Renders the sign-in screen shown to anyone who isn't logged in yet.
 * On successful sign-in, Supabase fires an auth state change event which
 * main.js listens for and uses to route the user to the right dashboard —
 * this module doesn't need to redirect anywhere itself.
 */

import { supabase } from './supabase.js'
import { AUTH_MESSAGES } from './config.js'

/**
 * Render the email/password login form into the given container element,
 * plus a "Forgot password?" link that reveals a second, email-only form
 * for requesting a reset link -- also how a first-time invitee who's lost
 * their invite email can get a fresh one, since Supabase sends the same
 * kind of recovery link either way. Submitting that link's URL back to
 * this app fires a PASSWORD_RECOVERY auth event, which main.js catches
 * and routes to set-password.js's "Set Your Password" form instead of
 * this one -- see that file's own doc comment.
 *
 * @param {HTMLElement} container - DOM element to render the form into.
 */
export function renderLogin(container) {
  // Render the sign-in form HTML
  container.innerHTML = `
    <div class="login-form">
      <h2>Sign In</h2>
      <form id="login-form">
        <input type="email" id="email" placeholder="Email" required />
        <input type="password" id="password" placeholder="Password" required />
        <button type="submit">Sign In</button>
        <p id="login-error" class="error hidden"></p>
      </form>
      <p class="forgot-password-link"><a href="#" id="forgot-password-toggle">Forgot password?</a></p>
      <form id="reset-form" class="hidden">
        <input type="email" id="reset-email" placeholder="Email" required />
        <button type="submit">Send Reset Link</button>
        <p id="reset-message" class="success hidden"></p>
        <p id="reset-error" class="error hidden"></p>
      </form>
    </div>
  `

  // Handle sign-in form submission
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault() // stop the browser's default full-page form submit

    const email = document.getElementById('email').value
    const password = document.getElementById('password').value
    const errorEl = document.getElementById('login-error')

    // Authenticate with Supabase. On success, this updates the Supabase
    // session, which triggers the onAuthStateChange listener in main.js.
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    // On failure, surface the error message returned by Supabase
    // (e.g. "Invalid login credentials") next to the form.
    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.remove('hidden')
    }
  })

  // "Forgot password?" toggles the reset-request form open/closed, in
  // place, without navigating anywhere -- matches the CSS comment on
  // .forgot-password-link in style.css ("the reset-request form it
  // toggles open").
  const forgotLink = document.getElementById('forgot-password-toggle')
  const resetForm = document.getElementById('reset-form')
  forgotLink.addEventListener('click', (e) => {
    e.preventDefault()
    const opening = resetForm.classList.contains('hidden')
    resetForm.classList.toggle('hidden', !opening)
    forgotLink.textContent = opening ? 'Back to sign in' : 'Forgot password?'
  })

  // Handle reset-request form submission
  resetForm.addEventListener('submit', async (e) => {
    e.preventDefault()

    const email = document.getElementById('reset-email').value
    const messageEl = document.getElementById('reset-message')
    const errorEl = document.getElementById('reset-error')
    messageEl.classList.add('hidden')
    errorEl.classList.add('hidden')

    // redirectTo sends the link back to wherever this app is currently
    // running (localhost in dev, the live domain in production) -- landing
    // back here fires PASSWORD_RECOVERY (see main.js), same as an invite
    // link.
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin
    })

    // Deliberately the same message whether or not that email actually has
    // an account, so this form can't be used to check who's registered --
    // see AUTH_MESSAGES.resetLinkGeneric's own doc comment in config.js.
    // A genuine failure (e.g. rate-limited) still surfaces Supabase's real
    // error message, since that's about the request itself, not the email.
    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.remove('hidden')
    } else {
      messageEl.textContent = AUTH_MESSAGES.resetLinkGeneric
      messageEl.classList.remove('hidden')
      resetForm.reset()
    }
  })
}
