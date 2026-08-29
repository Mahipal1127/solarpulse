import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { brandProfileSchema } from '@/lib/validation/schemas'
import { getBrandProfile, upsertBrandProfile, ServiceError } from '@/lib/services/marketing-creative'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The brand profile — the one-time form the AI Creative feature draws on "mainly".
 *
 * requireDepartmentOrThrow(MARKETING) admits the department and the CEO (read); the CEO is
 * refused on the write by isReadOnlyFor, matching every Marketing write path. There is no
 * credential anywhere in this payload — it is public-facing description, and 0021 has no
 * column for a secret.
 */
export async function GET() {
  try {
    await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const profile = await getBrandProfile()
    return NextResponse.json({ profile })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

export async function PUT(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team maintains the brand profile.' },
        { status: 403 }
      )
    }

    const parsed = brandProfileSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid brand profile', parsed.error.flatten())

    const profile = await upsertBrandProfile(user, parsed.data)
    return NextResponse.json({ profile })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
