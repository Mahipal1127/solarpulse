import { NextResponse, type NextRequest } from 'next/server'
import { passwordResetConfirmSchema } from '@/lib/validation/schemas'
import { resetPasswordWithQr, ServiceError } from '@/lib/services/password-reset'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Step 2 of the QR password reset: re-verify the (Employee ID, QR token) pair server-side — the
 * client's step-1 result is never trusted — then set the new password. Unauthenticated on
 * purpose, with the same reasoning and the same generic-mismatch behaviour as the verify route.
 * A successful reset is audit-logged (auth.password_reset_via_qr) with the token value omitted.
 */
export async function POST(request: NextRequest) {
  try {
    const parsed = passwordResetConfirmSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid password payload', parsed.error.flatten())

    await resetPasswordWithQr(parsed.data.employee_code, parsed.data.token, parsed.data.password)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}