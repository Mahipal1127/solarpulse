import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { updateInvoiceSchema } from '@/lib/validation/schemas'
import { updateInvoice, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Updates an invoice's editable fields (paid/partially_paid/overdue are system-driven). */
export async function PATCH(request: NextRequest, ctx: RouteContext<'/api/invoices/[invoiceId]'>) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])
    const { invoiceId } = await ctx.params

    const parsed = updateInvoiceSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid invoice payload', parsed.error.flatten())

    const invoice = await updateInvoice(user, invoiceId, parsed.data)
    return NextResponse.json({ invoice })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
