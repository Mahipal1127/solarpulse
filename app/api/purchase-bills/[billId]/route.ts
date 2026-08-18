import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { updatePurchaseBillSchema } from '@/lib/validation/schemas'
import { updatePurchaseBill, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Updates a purchase bill's editable fields (status is driven by vendor payments). */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/purchase-bills/[billId]'>) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])
    const { billId } = await ctx.params

    const parsed = updatePurchaseBillSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid purchase bill payload', parsed.error.flatten())

    const bill = await updatePurchaseBill(user, billId, parsed.data)
    return NextResponse.json({ bill })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
