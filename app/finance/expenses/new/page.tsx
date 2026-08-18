import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { ExpenseForm } from '@/components/finance/ExpenseForm'

export const dynamic = 'force-dynamic'

/**
 * Record an expense. A read-only viewer (CEO) gets a notice; recording is a Finance-member
 * action. The form surfaces the two domain rules itself: the optional salary-record link for
 * salary_disbursement, and the approval requirement at/above the (client-confirmed) threshold.
 */
export default async function NewExpensePage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])

  if (!isFinanceMember(user)) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Record expense</h1>
        </header>
        <Card>
          <EmptyState
            title="Read-only"
            description="Expenses are recorded by the Finance team. You are viewing this module read-only."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/finance/expenses" className="hover:text-brand-gold">
            Expenses
          </Link>
          <span>/</span>
          <span>New</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">Record expense</h1>
      </header>

      <Card>
        <CardHeader title="Expense details" />
        <div className="px-5 py-4">
          <ExpenseForm />
        </div>
      </Card>
    </div>
  )
}
