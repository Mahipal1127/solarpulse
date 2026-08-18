import { NextResponse, type NextRequest } from 'next/server'
import { requireAnyDepartmentOrThrow } from '@/lib/auth/guards'
import { recordExpenseSchema } from '@/lib/validation/schemas'
import { recordExpense, ServiceError, FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { errorResponse, badRequest } from '@/lib/api/responses'

/**
 * Records an expense. Runs record_expense(): the expense row plus a matching cash-flow
 * outflow, one transaction. A 'salary_disbursement' expense may carry linked_salary_record_id
 * (a bare audit FK to HR's record) — the amount is Finance's own figure, no salary read.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireAnyDepartmentOrThrow([...FINANCE_DEPARTMENT_SLUGS])

    const parsed = recordExpenseSchema.safeParse(await request.json())
    if (!parsed.success) return badRequest('Invalid expense payload', parsed.error.flatten())

    const result = await recordExpense(user, parsed.data)
    return NextResponse.json(result, { status: 201 })
  } catch (err) {
    if (err instanceof ServiceError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return errorResponse(err)
  }
}
