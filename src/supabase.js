/**
 * supabase.js
 *
 * Sets up a single, shared Supabase client for the whole app.
 * Every other module imports `supabase` from here instead of creating
 * its own client, so the app only ever holds one connection/session.
 */

import { createClient } from '@supabase/supabase-js'

// Replace these with the values from your Supabase project
// (Project Settings -> API in the Supabase dashboard).
const supabaseUrl = 'https://lirtdnsvxnizvpsmqjgr.supabase.co'

// NOTE: this is a "publishable" (anon) key, which is safe to expose in
// client-side code by design — it only grants the access allowed by your
// Supabase Row Level Security (RLS) policies. Never put a "service_role"
// (secret) key here or anywhere in frontend code.
const supabaseKey = 'sb_publishable_vioESOm81kuVqpJF0I1_ng_0qbilloX'

// Shared Supabase client instance, used for auth + all database queries.
export const supabase = createClient(supabaseUrl, supabaseKey)

