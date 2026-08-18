import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { createPurchaseBillSchema } from '@/lib/validation/schemas'
import { createPurchaseBill, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Records a vendor bill, against a Distribution PO (0007) or standalone. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])

    const parsed = createPurchaseBillSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid purchase bill payload', parsed.error.flatten())

    const bill = await createPurchaseBill(user, parsed.data)
    return NextResponse.json({ bill }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
