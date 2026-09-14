/**
 * password-rules.js
 *
 * Validation logic shared by every form that lets someone set/change a
 * password -- auth.js's "Set / Reset Password" form and
 * set-password.js's recovery-link form. Having one place for this means
 * the two forms can't quietly drift out of sync on what counts as a
 * valid password. The actual rule numbers and message wording live in
 * config.js (PASSWORD_RULES / PASSWORD_VALIDATION_MESSAGES) so they can
 * be changed without touching this logic.
 */

import { PASSWORD_RULES, PASSWORD_VALIDATION_MESSAGES } from './config.js'

// Anything that isn't a letter or digit counts as "special" here --
// punctuation, symbols, spaces, emoji, etc.
const SPECIAL_CHAR_PATTERN = /[^a-zA-Z0-9]/g

/**
 * Check a candidate password against the app's rules.
 *
 * @param {string} password
 * @param {string} confirmPassword
 * @returns {string|null} An error message if invalid, or null if the
 *   password passes every check.
 */
export function validatePassword(password, confirmPassword) {
  if (password.length < PASSWORD_RULES.minLength) {
    return PASSWORD_VALIDATION_MESSAGES.tooShort(PASSWORD_RULES.minLength)
  }

  const specialCharCount = (password.match(SPECIAL_CHAR_PATTERN) || []).length
  if (specialCharCount > PASSWORD_RULES.maxSpecialChars) {
    return PASSWORD_VALIDATION_MESSAGES.tooManySpecialChars(PASSWORD_RULES.maxSpecialChars)
  }

  if (password !== confirmPassword) {
    return PASSWORD_VALIDATION_MESSAGES.mismatch
  }

  return null
}
