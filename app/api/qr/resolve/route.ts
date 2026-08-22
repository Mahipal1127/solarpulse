import { NextResponse, type NextRequest } from 'next/server'
import { resolveTokenSchema } from '@/lib/validation/schemas'
import { resolveToken } from '@/lib/services/id-cards'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Resolves a scanned QR token to an employee identity — the ONE endpoint the (separately built)
 * Attendance Panel calls. It does NOT write attendance; it answers "who is this token?" and
 * nothing more. The panel takes the identity and decides what to do (mark in/out) through its own
 * authenticated endpoints.
 *
 * WHY IT IS UNAUTHENTICATED. The caller is a shared attendance kiosk with no per-user session —
 * an employee walks up and scans. resolveToken runs on the service-role client for exactly this
 * reason (qr_tokens has no readable-by-anyone RLS policy), returning null for an unknown OR revoked
 * token without ever distinguishing the two, so a probe learns nothing and a lost card's token
 * stops resolving the instant HR revokes it.
 *
 * SECURITY GATE. Because this is network-exposed and returns employee PII (name, photo, dept), it
 * supports an OPTIONAL shared secret: if QR_RESOLVE_SECRET is set, callers must send it as
 * 'x-kiosk-secret'. This is intentionally optional — with no secret configured the endpoint serves
 * the open-kiosk model the panel assumes (dev/demo/trusted-LAN); set the env var in any deployment
 * where the endpoint is reachable beyond the kiosk network. The token itself is a 256-bit opaque
 * value that is infeasible to guess, so the secret guards against scraping with a photographed
 * card, not against brute force.
 *
 * NOTE: no attendance is written here and no audit row is created for a resolve — a scan is a read,
 * and the panel audits the attendance action it performs with the result.
 */
export async function POST(request: NextRequest) {
  try {
    const requiredSecret = process.env.QR_RESOLVE_SECRET
    if (requiredSecret && request.headers.get('x-kiosk-secret') !== requiredSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = resolveTokenSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid token payload', parsed.error.flatten())

    const identity = await resolveToken(parsed.data.token)
    // A revoked or unknown token is a clean 404 with no detail — never a hint about which.
    if (!identity) return NextResponse.json({ identity: null }, { status: 404 })

    return NextResponse.json({ identity })
  } catch (err) {
    return errorResponse(err)
  }
}
