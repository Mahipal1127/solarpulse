import 'server-only'

import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

/**
 * Session-bound server client. Uses the anon key, so RLS still applies — this is
 * what server components and most route handler reads should use.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies()

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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
    }
  )
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
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set')

  return createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    cookies: { getAll: () => [], setAll: () => {} },
  })
}
