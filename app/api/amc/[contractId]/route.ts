import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { updateAmcContractSchema } from '@/lib/validation/schemas'
import { updateAmcContract, ServiceError, OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { errorResponse, badRequest } from '@/lib/api/responses'

export async function PATCH(
  request: NextRequest,
  ctx: RouteContext<'/api/amc/[contractId]'>
) {
  try {
    const user = await requireDepartmentOrThrow(OM_DEPARTMENT_SLUG)
    const { contractId } = await ctx.params

    const parsed = updateAmcContractSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid update payload', parsed.error.flatten())

    const contract = await updateAmcContract(user, contractId, parsed.data)
    return NextResponse.json({ contract })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
