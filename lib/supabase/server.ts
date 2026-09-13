import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Session-bound server client. Uses the anon key, so RLS still applies — this is
 * what server components and most route handler reads should use.
 *
 * On Netlify, env vars are set per deploy in the dashboard. A `!` non-null
 * assertion here would throw at module-init time and blank the whole site, so we
 * fail loud with a readable error instead — same effect, easier to debug from
 * the Netlify function logs.
 */
export async function createSupabaseServerClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error(
      'Supabase env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL and ' +
        'NEXT_PUBLIC_SUPABASE_ANON_KEY in Netlify Site settings → Environment variables.'
    )
  }

  const cookieStore = await cookies()

  return createServerClient(url, anonKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          )
        } catch {
          // Called from a server component, where cookies are read-only.
          // Session refresh is handled by middleware instead.
        }
      },
    },
  })
}

/**
 * Service-role client. Bypasses RLS entirely — only for writes that must not be
 * forgeable from the browser (audit logs) or that read columns no role may
 * select (ai_settings.encrypted_api_key).
 *
 * Every call site must perform its own permission check first, normally via
 * requireRole('CEO'). Never import this into a client component.
 */
export function createSupabaseServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Supabase service-role env vars are missing. Set NEXT_PUBLIC_SUPABASE_URL ' +
        'and SUPABASE_SERVICE_ROLE_KEY in Netlify Site settings → Environment variables.'
    )
  }

  return createServerClient(url, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}
