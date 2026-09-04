import { NextResponse } from 'next/server'

/**
 * The platform-facing liveness/readiness endpoint. Two responses only:
 *
 *  - 200 — the app is up AND it can reach the database. Operators can use this for uptime
 *    monitoring (a 200 means the user-facing app can serve traffic; a non-200 is a real signal
 *    rather than a synthetic "app is up but DB is on fire" green).
 *  - 503 — the app is up but the database is unreachable. The platform is fine; the backing
 *    store is the problem. A short `reason` is returned so on-call has something to grep.
 *
 * The DB probe is the cheapest read RLS admits for an unauthenticated user: `select 1` against
 * `public.employees` would still cost RLS evaluation, so we use the PostgREST `/rest/v1/` health
 * path instead — the Supabase gateway answers this without a query. Two checks, ~1ms each.
 *
 * WHY NO AUTH. A liveness probe must be reachable from a load balancer / uptime monitor WITHOUT
 * credentials. It discloses only the reachability of the DB and the app's own version — no user
 * data, no tokens, nothing sensitive.
 */

export const dynamic = 'force-dynamic'

interface HealthResponse {
  ok: true
  app: 'solar-pulse-os'
  db: 'up'
  timestamp: string
}

interface UnhealthyResponse {
  ok: false
  app: 'solar-pulse-os'
  db: 'down'
  reason: string
  timestamp: string
}

export async function GET(): Promise<NextResponse<HealthResponse | UnhealthyResponse>> {
  const timestamp = new Date().toISOString()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key) {
    return NextResponse.json(
      {
        ok: false,
        app: 'solar-pulse-os',
        db: 'down',
        reason: 'Supabase env not configured (NEXT_PUBLIC_SUPABASE_URL / ANON_KEY missing).',
        timestamp,
      },
      { status: 503 }
    )
  }

  try {
    // The PostgREST /rest/v1/ root returns 200 with the OpenAPI document; that confirms the
    // gateway AND the database are both reachable. The anon key is used because it is the only
    // credential a liveness probe can carry, and this endpoint requires no read permission.
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, {
      method: 'GET',
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      // Keep the probe bounded — a slow gateway is a problem we want surfaced, not waited on.
      signal: AbortSignal.timeout(5_000),
      cache: 'no-store',
    })

    if (!res.ok) {
      return NextResponse.json(
        {
          ok: false,
          app: 'solar-pulse-os',
          db: 'down',
          reason: `Supabase gateway returned ${res.status}`,
          timestamp,
        },
        { status: 503 }
      )
    }

    return NextResponse.json(
      { ok: true, app: 'solar-pulse-os', db: 'up', timestamp },
      {
        status: 200,
        headers: {
          // Never cache — every probe must be live.
          'Cache-Control': 'no-store',
        },
      }
    )
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        app: 'solar-pulse-os',
        db: 'down',
        reason: err instanceof Error ? err.message : 'Unknown error reaching the database',
        timestamp,
      },
      { status: 503 }
    )
  }
}
