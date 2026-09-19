/**
 * set_user_password.mjs
 *
 * One-off admin tool: directly sets a Supabase Auth user's password,
 * completely bypassing the "Forgot password?" email flow. Written for
 * Deepa's case specifically -- her account exists and she's signed in
 * before (confirmed via Dashboard > Authentication > Users > her row >
 * Overview), but the reset-email flow isn't working for her right now,
 * and the dashboard's own user panel only offers "Send password
 * recovery" (an email -- the same flow that's already failing for her)
 * and "Send magic link". Setting a password directly for an existing
 * user is only exposed via Supabase's Admin API, not the dashboard UI --
 * see https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid.
 *
 * Usage (run from the project root, in your own terminal):
 *
 *   SUPABASE_SERVICE_ROLE_KEY=<paste-here> node data_import/set_user_password.mjs deepa@example.com "TempPassw0rd!"
 *
 * Then give Deepa that temporary password directly (call/text/in person,
 * not email if email is what's not reaching her) so she can sign in.
 *
 * IMPORTANT -- about the service_role key:
 *  - This is NOT the same as the "publishable"/anon key in src/supabase.js.
 *    It bypasses every Row Level Security policy in the project -- full
 *    admin access.
 *  - Get it from Supabase Dashboard -> Project Settings -> API ->
 *    "service_role" (click to reveal, then copy).
 *  - Only ever pass it as an environment variable, in your own terminal,
 *    for a one-off run like this.
 *  - NEVER put it in this file, any other file, or anywhere it could get
 *    committed to git -- treat it like a master password for the whole
 *    database.
 */

import { createClient } from '@supabase/supabase-js'

const [, , email, newPassword] = process.argv

if (!email || !newPassword) {
  console.error('Usage: SUPABASE_SERVICE_ROLE_KEY=... node data_import/set_user_password.mjs <email> <new-password>')
  process.exit(1)
}

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!serviceRoleKey) {
  console.error('Missing SUPABASE_SERVICE_ROLE_KEY env var -- see the comment at the top of this file for where to get it.')
  process.exit(1)
}

// Same project URL as src/supabase.js -- only the key differs (service_role
// here, vs. the publishable/anon key the app itself uses).
const supabaseUrl = 'https://lirtdnsvxnizvpsmqjgr.supabase.co'
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey)

// Look up by email rather than requiring a UID up front, so this is easy
// to run for anyone without first copying an id out of the dashboard.
// perPage bumped well above this app's user count so one page covers
// everyone -- fine for a group this size; would need real pagination for
// a much larger user base.
const { data: usersPage, error: listError } = await supabaseAdmin.auth.admin.listUsers({ perPage: 1000 })
if (listError) {
  console.error('Failed to list users:', listError.message)
  process.exit(1)
}

const user = usersPage.users.find(u => u.email?.toLowerCase() === email.toLowerCase())
if (!user) {
  console.error(`No auth user found with email ${email}`)
  process.exit(1)
}

const { error: updateError } = await supabaseAdmin.auth.admin.updateUserById(user.id, { password: newPassword })
if (updateError) {
  console.error('Failed to set password:', updateError.message)
  process.exit(1)
}

console.log(`Password set for ${email} (user id ${user.id}).`)
console.log('Give it to them directly (not email, if email is the broken part) so they can sign in.')
