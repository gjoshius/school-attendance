import { createClient } from '@supabase/supabase-js'

// Replace these with the values from your Supabase project
const supabaseUrl = 'https://lirtdnsvxnizvpsmqjgr.supabase.co'
const supabaseKey = 'sb_publishable_vioESOm81kuVqpJF0I1_ng_0qbilloX'

export const supabase = createClient(supabaseUrl, supabaseKey)