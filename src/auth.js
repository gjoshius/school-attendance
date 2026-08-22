import { supabase } from './supabase.js'

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
    e.preventDefault()
    const email = document.getElementById('email').value
    const password = document.getElementById('password').value
    const errorEl = document.getElementById('login-error')

    // Authenticate with Supabase
    const { error } = await supabase.auth.signInWithPassword({ email, password })

    if (error) {
      errorEl.textContent = error.message
      errorEl.classList.remove('hidden')
    }
  })
}