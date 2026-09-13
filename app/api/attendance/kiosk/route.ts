import { NextResponse, type NextRequest } from 'next/server'
import { resolveTokenSchema } from '@/lib/validation/schemas'
import { markKioskAttendance } from '@/lib/services/kiosk'
import { ServiceError } from '@/lib/services/tasks'
import { errorResponse } from '@/lib/api/responses'

/**
 * The kiosk's write endpoint: a scanned token marks the employee in or out.
 *
 * SECURITY — same model as POST /api/qr/resolve, one step stricter. The caller
 * is an unauthenticated shared device; the credential IS the scanned token
 * (256-bit opaque, revocable — see lib/services/kiosk.ts). But this endpoint
 * WRITES, so when QR_RESOLVE_SECRET is configured the kiosk must present it as
 * 'x-kiosk-secret' — set the env var in any deployment where this endpoint is
 * reachable beyond the kiosk's own network. Unauthenticated-without-secret is
 * the dev/demo posture, exactly as the resolve route documents.
 */
export async function POST(request: NextRequest) {
  try {
    const requiredSecret = process.env.QR_RESOLVE_SECRET
    if (requiredSecret && request.headers.get('x-kiosk-secret') !== requiredSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const parsed = resolveTokenSchema.safeParse(await request.json())
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid token payload' }, { status: 400 })
    }

    const result = await markKioskAttendance(parsed.data.token)
    return NextResponse.json(result)
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}