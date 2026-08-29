import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { connectInstagramAccountSchema } from '@/lib/validation/schemas'
import { connectAccount, listConnectedAccounts, ServiceError } from '@/lib/services/instagram'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Connected Instagram accounts.
 *
 * requireDepartmentOrThrow(MARKETING) admits the Marketing department and the CEO, matching
 * the read side of the RLS policies in 0020. The CEO is then refused on POST by
 * isReadOnlyFor, exactly as in every other module — connecting a channel is the team's job,
 * and the CEO reads what the team publishes.
 *
 * That check is not belt-and-braces here, it is load bearing: parts of this feature write
 * through the service-role client, which bypasses RLS, so a write the guard lets through is
 * a write the database will not stop.
 */
export async function GET() {
  try {
    await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    const accounts = await listConnectedAccounts()
    return NextResponse.json({ accounts })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * Connect a handle. Creates the row a sync fills in — this endpoint collects nothing from
 * Instagram itself and holds no credential of any kind.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(MARKETING_DEPARTMENT_SLUG)
    if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) {
      return NextResponse.json(
        { error: 'Read-only — the Marketing team connects the account.' },
        { status: 403 }
      )
    }

    const parsed = connectInstagramAccountSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid payload', parsed.error.flatten())

    const account = await connectAccount(user, parsed.data.username)
    return NextResponse.json({ account }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
