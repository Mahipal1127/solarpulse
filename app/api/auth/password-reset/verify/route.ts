import { NextResponse, type NextRequest } from 'next/server'
import { passwordResetVerifySchema } from '@/lib/validation/schemas'
import { verifyResetIdentity, ServiceError } from '@/lib/services/password-reset'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Step 1 of the QR password reset: verify the (Employee ID, attendance QR token) pair and return
 * the display identity for the confirmation screen.
 *
 * UNAUTHENTICATED ON PURPOSE — the caller is by definition someone who cannot sign in. The gate
 * is the pair itself: the QR token is a 256-bit opaque, revocable secret and the Employee ID must
 * belong to the same card. Mismatches, revoked cards and unknown codes all answer with the same
 * generic message. Rate limiting is the deployment edge's job, exactly as for /api/qr/resolve.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = passwordResetVerifySchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid payload', parsed.error.flatten())

    const identity = await verifyResetIdentity(parsed.data.employee_code, parsed.data.token)
    return NextResponse.json({ verified: true, identity })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}