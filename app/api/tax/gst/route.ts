import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { createGstFilingSchema } from '@/lib/validation/schemas'
import { createGstFiling, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a GST filing period record. output/input GST are adjustable before it's filed. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])

    const parsed = createGstFilingSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid GST filing payload', parsed.error.flatten())

    const filing = await createGstFiling(user, parsed.data)
    return NextResponse.json({ filing }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
