/**
 * password-toggle.js
 *
 * Shared "show/hide password" eye button for every password <input> in
 * the app (sign-in, the combined Set/Reset Password form, and the
 * recovery-link Set Your Password form) -- one place for the markup and
 * behavior so all of them stay visually and functionally identical,
 * same reasoning as password-rules.js for validation.
 */

// Two small inline icons (eye / eye-with-a-slash-through-it) rather than
// an emoji -- 👁 renders noticeably differently across platforms/fonts,
// these look identical everywhere and pick up the button's own text
// color via currentColor.
const EYE_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z"/><circle cx="12" cy="12" r="3"/></svg>'
const EYE_OFF_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.6 21.6 0 0 1 5.06-5.94M9.9 4.24A10.7 10.7 0 0 1 12 4c7 0 11 7 11 7a21.6 21.6 0 0 1-2.61 3.61M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'

/**
 * Markup for one password field with its eye toggle baked in -- a
 * drop-in replacement for a plain `<input type="password">`: same id,
 * placeholder and required-ness, just wrapped so the button can sit
 * inside the field. Call wirePasswordToggles() once after the containing
 * form's innerHTML (with this inside it) is actually in the DOM.
 *
 * @param {string} id
 * @param {string} placeholder
 * @param {boolean} [required]
 * @returns {string}
 */
export function passwordFieldHtml(id, placeholder, required = true) {
  return `
    <div class="password-field">
      <input type="password" id="${id}" placeholder="${placeholder}" ${required ? 'required' : ''} />
      <button type="button" class="password-toggle-btn" data-target="${id}" aria-label="Show password" aria-pressed="false">${EYE_ICON}</button>
    </div>
  `
}

/**
 * Wires up every .password-toggle-btn inside `container` -- call once,
 * right after setting innerHTML that includes one or more
 * passwordFieldHtml() fields (same render-then-wire order used
 * everywhere else in this app). Each button only ever affects its own
 * data-target input, so a form with two password fields (new + confirm)
 * toggles them independently.
 *
 * @param {HTMLElement} container
 */
export function wirePasswordToggles(container) {
  container.querySelectorAll('.password-toggle-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const input = document.getElementById(btn.dataset.target)
      if (!input) return
      const willShow = input.type === 'password'
      input.type = willShow ? 'text' : 'password'
      btn.innerHTML = willShow ? EYE_OFF_ICON : EYE_ICON
      btn.setAttribute('aria-label', willShow ? 'Hide password' : 'Show password')
      btn.setAttribute('aria-pressed', String(willShow))
    })
  })
}
