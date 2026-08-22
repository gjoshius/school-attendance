/**
 * auth.js
 *
 * Renders the sign-in screen shown to anyone who isn't logged in yet.
 * On successful sign-in, Supabase fires an auth state change event which
 * main.js listens for and uses to route the user to the right dashboard —
 * this module doesn't need to redirect anywhere itself.
 */

import { supabase } from './supabase.js'

/**
 * Render the email/password login form into the given container element.
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
    </div>
  `

  // Handle form submission
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
}
