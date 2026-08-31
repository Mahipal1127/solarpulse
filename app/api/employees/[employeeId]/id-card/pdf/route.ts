import { type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { buildCardPdf } from '@/lib/services/card-pdf'
import { ServiceError } from '@/lib/services/id-cards'
import { NextResponse } from 'next/server'
import { errorResponse } from '@/lib/api/responses'

/**
 * Streams the employee's two-sided ID card as a downloadable PDF (front page, back
 * page). Built on demand from the stored PNGs — see buildCardPdf, which also owns the
 * access decision via an RLS read (HR lead, CEO, or the employee's own board).
 *
 * The HR-module route guard is the outer gate; the RLS read inside buildCardPdf is
 * the one that actually scopes WHICH employee's card a caller may fetch.
 */
export async function GET(
  _request: NextRequest,
  ctx: RouteContext<'/api/employees/[employeeId]/id-card/pdf'>
) {
  try {
    await requireDepartmentOrThrow(HR_DEPARTMENT_SLUG)
    const { employeeId } = await ctx.params

    const pdf = await buildCardPdf(employeeId)

    // Uint8Array → a fresh ArrayBuffer-backed body the Response can stream.
    const body = new Uint8Array(pdf)
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="id-card-${employeeId}.pdf"`,
        'Cache-Control': 'no-store',
      },
    })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
