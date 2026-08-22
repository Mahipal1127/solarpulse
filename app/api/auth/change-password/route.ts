import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { changePasswordSchema } from '@/lib/validation/schemas'
import { changeOwnPassword, ServiceError } from '@/lib/services/account'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Sets the caller's own password and clears the forced-change flag. Any authenticated user may
 * call it; it only ever acts on the caller (requireUserOrThrow resolves the identity from the
 * session, never the body), so it cannot touch another account.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const parsed = changePasswordSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid password payload', parsed.error.flatten())

    await changeOwnPassword(user, parsed.data.password)
    return NextResponse.json({ ok: true })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
