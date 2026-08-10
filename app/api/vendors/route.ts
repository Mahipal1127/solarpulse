import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createVendorSchema } from '@/lib/validation/schemas'
import {
  createVendor,
  ServiceError,
  DISTRIBUTION_DEPARTMENT_SLUG,
} from '@/lib/services/distribution'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(DISTRIBUTION_DEPARTMENT_SLUG)

    const parsed = createVendorSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid vendor payload', parsed.error.flatten())

    const vendor = await createVendor(user, parsed.data)
    return NextResponse.json({ vendor }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
