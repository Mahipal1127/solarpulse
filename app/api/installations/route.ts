import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createInstallationSchema } from '@/lib/validation/schemas'
import {
  createInstallation,
  ServiceError,
  OM_DEPARTMENT_SLUG,
} from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a standalone installation. The deal-conversion flow is POST /convert. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)

    const parsed = createInstallationSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid installation payload', parsed.error.flatten())

    const installation = await createInstallation(user, parsed.data)
    return NextResponse.json({ installation }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
