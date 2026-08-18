import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { createInvoiceSchema } from '@/lib/validation/schemas'
import { createInvoice, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates an invoice, optionally converted from a closed deal / completed installation. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])

    const parsed = createInvoiceSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid invoice payload', parsed.error.flatten())

    const invoice = await createInvoice(user, parsed.data)
    return NextResponse.json({ invoice }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
