import { NextResponse, type NextRequest } from 'next/server'
import { createServerClient } from '@supabase/ssr'

/**
 * Proxy — Next 16's renamed `middleware` (see node_modules/next/dist/docs/.../proxy.md). Runs on
 * the Node.js runtime before any route renders. It does two things:
 *
 *  1. REFRESHES the Supabase session on every navigation, writing rotated auth cookies onto the
 *     response. Server components read cookies read-only (see lib/supabase/server.ts), so without
 *     this the session would eventually go stale — the comment there already promised "handled by
 *     middleware"; this is where that finally happens.
 *
 *  2. FORCED PASSWORD CHANGE. An HR-onboarded account starts with must_change_password = true and
 *     a temporary password HR does not keep. Until the employee sets their own, this gate redirects
 *     every protected route to /change-password. It is enforced HERE, not in a layout, precisely so
 *     a direct URL to a deep route cannot slip past it — the chosen "robust against URL bypass"
 *     design. RLS is still the source of truth for data; this is a routing gate on top.
 *
 * WHY A DB READ PER REQUEST. must_change_password lives on the employees row, not the JWT, so the
 * gate reads it via the session client (the 0001 self-view policy lets a user see their own row).
 * That is one indexed point-read on protected navigations only — the matcher excludes static
 * assets, _next, and the login/change-password surfaces — acceptable for an internal ERP. If this
 * ever proves hot, promote the flag to a JWT app_metadata claim and read it from the token instead.
 */

// Paths that must stay reachable WHILE must_change_password is true, or the gate would trap the
// user (can't reach the page that clears the flag) or break login itself.
//
// /reset-password is allowlisted too: it IS the forgot-my-password surface, so it must stay
// reachable even for a signed-in user who is mid forced-change — that person is exactly the one
// who lost the temporary password HR handed over. Identity there is proven by the Employee ID +
// attendance-QR pairing inside the page, never by a session.
const ALLOWLIST = ['/login', '/change-password', '/reset-password', '/forbidden']

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() revalidates the token with Supabase and triggers the cookie refresh above.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const { pathname } = request.nextUrl
  const isAllowlisted = ALLOWLIST.some((p) => pathname === p || pathname.startsWith(`${p}/`))

  // Only an authenticated user on a non-allowlisted route can be gated. An anonymous user is left
  // to the page-level guards (which redirect to /login) — the proxy's job here is the password
  // gate and session refresh, not auth enforcement, which RLS + the guards already own.
  if (user && !isAllowlisted) {
    const { data: employee, error } = await supabase
      .from('employees')
      .select('must_change_password')
      .eq('user_id', user.id)
      .maybeSingle()

    // A failed query and "no such employee" both arrive as no row, so a missing column would
    // disable this gate on every navigation with nothing to show for it. Most likely cause:
    // migration 0018 (which adds must_change_password) has not been applied to this database.
    // Deliberately fail OPEN — a broken read must not lock the whole app behind /change-password.
    if (error) console.error('[proxy] password-gate read failed', error.message)

    // No employees row (e.g. the CEO) → nothing to enforce. Only a live true flag gates.
    if (employee?.must_change_password) {
      const url = request.nextUrl.clone()
      url.pathname = '/change-password'
      url.search = ''
      return NextResponse.redirect(url)
    }
  }

  return response
}

export const config = {
  // Run on everything EXCEPT api routes, Next internals, and static asset files. Excluding /api
  // keeps the gate off the change-password submit endpoint (and every other API call, which is
  // fine — the browser only navigates to protected PAGES, and those are covered).
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|ico|webp)$).*)'],
}
