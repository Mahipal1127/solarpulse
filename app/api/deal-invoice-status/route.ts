import { NextResponse, type NextRequest } from 'next/server'
import { requireUserOrThrow } from '@/lib/auth/guards'
import { getDealInvoiceStatus, ServiceError } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * The narrow cross-department exception: a Sales user checks their OWN deal's invoice
 * status without any general Finance access. Open to every authenticated user, but the
 * underlying get_invoice_status_for_deal() RPC (0016) enforces deal ownership internally
 * and returns only status/amount/due-date — never a full invoice row, never someone else's
 * deal. This is the ONLY Finance data reachable from outside the department, and the read
 * is logged (logSensitiveAccess) so the exception stays auditable.
 *
 * Usage: GET /api/deal-invoice-status?dealClosureId=<uuid>
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUserOrThrow()

    const dealClosureId = request.nextUrl.searchParams.get('dealClosureId')
    if (!dealClosureId) return badRequest('dealClosureId is required')

    const invoices = await getDealInvoiceStatus(user, dealClosureId)
    return NextResponse.json({ invoices })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
