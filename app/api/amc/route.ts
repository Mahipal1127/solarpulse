import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createAmcContractSchema } from '@/lib/validation/schemas'
import { createAmcContract, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)

    const parsed = createAmcContractSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid AMC payload', parsed.error.flatten())

    const contract = await createAmcContract(user, parsed.data)
    return NextResponse.json({ contract }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
