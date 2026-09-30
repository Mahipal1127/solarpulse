import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createRooftopProjectSchema } from '@/lib/validation/schemas'
import {
  createRooftopProject,
  ServiceError,
  ROOFTOP_DEPARTMENT_SLUG,
} from '@/lib/services/rooftop'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a rooftop project for a customer site. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(ROOFTOP_DEPARTMENT_SLUG)

    const parsed = createRooftopProjectSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid rooftop project payload', parsed.error.flatten())

    const project = await createRooftopProject(user, parsed.data)
    return NextResponse.json({ project }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
