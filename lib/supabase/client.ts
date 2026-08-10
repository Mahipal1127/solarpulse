import { createBrowserClient } from '@supabase/ssr'

/**
 * Browser client. Anon key only — every query it makes is governed by RLS.
 * Never import this from a route handler.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}
