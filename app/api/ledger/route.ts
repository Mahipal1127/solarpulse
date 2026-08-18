import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { createLedgerEntrySchema } from '@/lib/validation/schemas'
import { createLedgerEntry, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Creates a manual ledger entry (lead/CEO only — enforced in the service). */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])

    const parsed = createLedgerEntrySchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid ledger payload', parsed.error.flatten())

    const entry = await createLedgerEntry(user, parsed.data)
    return NextResponse.json({ entry }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
