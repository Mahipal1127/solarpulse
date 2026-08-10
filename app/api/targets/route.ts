import { NextResponse, type NextRequest } from 'next/server'
import { requireDepartmentOrThrow } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSalesTargetSchema } from '@/lib/validation/schemas'
import { createSalesTarget, ServiceError, SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { errorResponse, badRequest } from '@/lib/api/responses'

/** Create a target. Sales Manager or CEO only — enforced in the service layer. */
export async function POST(request: NextRequest) {
  try {
    const user = await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)

    const parsed = createSalesTargetSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid target payload', parsed.error.flatten())

    const target = await createSalesTarget(user, parsed.data)
    return NextResponse.json({ target }, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}

/**
 * List targets. RLS decides the rows: an executive sees only their own,
 * a manager or the CEO sees the whole department.
 */
export async function GET() {
  try {
    await requireDepartmentOrThrow(SALES_DEPARTMENT_SLUG)
    const supabase = await createSupabaseServerClient()

    const { data, error } = await supabase
      .from('sales_targets')
      .select('*, employee:users!sales_targets_user_id_fkey(full_name)')
      .order('period_start', { ascending: false })
      .limit(200)

    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ targets: data ?? [] })
  } catch (err) {
    return errorResponse(err)
  }
}
