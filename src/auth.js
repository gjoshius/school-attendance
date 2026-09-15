/**
 * auth.js
 *
 * Renders the sign-in screen shown to anyone who isn't logged in yet.
 * On successful sign-in, Supabase fires an auth state change event which
 * main.js listens for and uses to route the user to the right dashboard —
 * this module doesn't need to redirect anywhere itself.
 */

import { supabase } from './supabase.js'
import { AUTH_MESSAGES, PASSWORD_RULES } from './config.js'
import { validatePassword } from './password-rules.js'
import { passwordFieldHtml, wirePasswordToggles } from './password-toggle.js'

/**
 * Render the email/password login form into the given container element,
 * plus two toggle links:
 *  - "Forgot password?" reveals a second, email-only form for requesting
 *    a reset link -- also how a first-time invitee who's lost their invite
 *    email can get a fresh one, since Supabase sends the same kind of
 *    recovery link either way *if their auth.users account already
 *    exists* (e.g. an admin already ran data_import/invite_teachers.mjs
 *    for them). Submitting that link's URL back to this app fires a
 *    PASSWORD_RECOVERY auth event, which main.js catches and routes to
 *    set-password.js's "Set Your Password" form instead of this one --
 *    see that file's own doc comment.
 *  - "New teacher? Set up your account" reveals a self-signup form (email
 *    + new password) for someone whose email an admin has already put in
 *    teacher_registrations but who has no auth.users account yet at all --
 *    no admin invite step required first. Calls supabase.auth.signUp()
 *    directly; the moment that creates their auth.users row,
 *    data_import/08c_sync_teacher_profiles.sql's trigger fires and fills
 *    in their profiles row (and any pending class assignment)
 *    automatically from that same teacher_registrations row, so signing up
 *    here is all they need to do.
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
        ${passwordFieldHtml('password', 'Password')}
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
      <p class="forgot-password-link"><a href="#" id="signup-toggle">New teacher? Set up your account</a></p>
      <form id="signup-form" class="hidden">
        <input type="email" id="signup-email" placeholder="Email" required />
        ${passwordFieldHtml('signup-password', `New password (min ${PASSWORD_RULES.minLength} characters)`)}
        ${passwordFieldHtml('signup-confirm-password', 'Confirm password')}
        <button type="submit">Set Password</button>
        <p id="signup-message" class="success hidden"></p>
        <p id="signup-error" class="error hidden"></p>
      </form>
    </div>
  `

  wirePasswordToggles(container)

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

  // "Forgot password?" and "New teacher?" each toggle their own form
  // open/closed, in place, without navigating anywhere -- matches the CSS
  // comment on .forgot-password-link in style.css ("the reset-request
  // form it toggles open"). Opening one closes the other, so at most one
  // secondary form is ever open alongside the main sign-in form.
  const forgotLink = document.getElementById('forgot-password-toggle')
  const resetForm = document.getElementById('reset-form')
  const signupLink = document.getElementById('signup-toggle')
  const signupForm = document.getElementById('signup-form')

  forgotLink.addEventListener('click', (e) => {
    e.preventDefault()
    const opening = resetForm.classList.contains('hidden')
    resetForm.classList.toggle('hidden', !opening)
    forgotLink.textContent = opening ? 'Back to sign in' : 'Forgot password?'
    if (opening) {
      signupForm.classList.add('hidden')
      signupLink.textContent = 'New teacher? Set up your account'
    }
  })

  signupLink.addEventListener('click', (e) => {
    e.preventDefault()
    const opening = signupForm.classList.contains('hidden')
    signupForm.classList.toggle('hidden', !opening)
    signupLink.textContent = opening ? 'Back to sign in' : 'New teacher? Set up your account'
    if (opening) {
      resetForm.classList.add('hidden')
      forgotLink.textContent = 'Forgot password?'
    }
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

  // Handle self-signup form submission
  signupForm.addEventListener('submit', async (e) => {
    e.preventDefault()

    const email = document.getElementById('signup-email').value
    const password = document.getElementById('signup-password').value
    const confirmPassword = document.getElementById('signup-confirm-password').value
    const messageEl = document.getElementById('signup-message')
    const errorEl = document.getElementById('signup-error')
    messageEl.classList.add('hidden')
    errorEl.classList.add('hidden')

    // Same rules as set-password.js's recovery-link form -- see
    // password-rules.js.
    const validationError = validatePassword(password, confirmPassword)
    if (validationError) {
      errorEl.textContent = validationError
      errorEl.classList.remove('hidden')
      return
    }

    const { data, error } = await supabase.auth.signUp({ email, password })

    if (error) {
      // Supabase's own wording for "this email is already fully
      // registered" varies by version; catch it here rather than showing
      // its raw (sometimes confusing) message.
      messageEl.textContent = /already registered/i.test(error.message)
        ? AUTH_MESSAGES.pendingInvite
        : ''
      if (messageEl.textContent) {
        messageEl.classList.remove('hidden')
      } else {
        errorEl.textContent = error.message
        errorEl.classList.remove('hidden')
      }
      return
    }

    if (data.session) {
      // Confirmations are off for this project -- signUp() signed them in
      // immediately, so main.js's onAuthStateChange is about to route them
      // straight to their dashboard. Still show the message in case there's
      // any delay before that re-render happens.
      messageEl.textContent = AUTH_MESSAGES.accountCreatedCanSignIn
    } else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      // Supabase's anti-enumeration signal for "this email already has a
      // confirmed account" -- no error, no session, just an empty
      // identities array. Point them at "Forgot password?" instead.
      messageEl.textContent = AUTH_MESSAGES.alreadyRegistered
    } else {
      // Brand new signup, confirmations are on -- Supabase emailed them a
      // confirmation link.
      messageEl.textContent = AUTH_MESSAGES.accountCreatedNeedsConfirmation
    }
    messageEl.classList.remove('hidden')
    signupForm.reset()
  })
}
