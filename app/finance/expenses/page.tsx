import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getExpenses } from '@/lib/finance/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { EXPENSE_CATEGORY_LABELS, formatCurrency, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Expenses. Each recorded expense posts a matching cash-flow outflow (record_expense). RLS
 * scopes an exec to expenses they recorded, a lead/CEO to all. A salary_disbursement expense
 * shows a badge that it is linked to an HR salary record. "Record expense" is hidden for a
 * read-only viewer.
 */
export default async function ExpensesPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const canWrite = isFinanceMember(user)
  const expenses = await getExpenses()

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Expenses</h1>
          <p className="mt-1 text-sm text-text-muted">
            Operating costs, recorded with a matching cash-flow entry. Larger expenses route
            through a CEO approval first.
          </p>
        </div>
        {canWrite && (
          <Link
            href="/finance/expenses/new"
            className="shrink-0 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            Record expense
          </Link>
        )}
      </header>

      <Card>
        <CardHeader title="All expenses" subtitle={`${expenses.length} shown`} />
        {expenses.length === 0 ? (
          <EmptyState
            title="No expenses yet"
            description="Expenses you record appear here, newest first."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Category</th>
                  <th className="px-4 py-3 font-semibold">Description</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {expenses.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-text-muted">{formatDate(e.expense_date)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="text-brand-slate">
                          {EXPENSE_CATEGORY_LABELS[e.category]}
                        </span>
                        {e.linked_salary_record_id && (
                          <Badge className="badge-info">Salary</Badge>
                        )}
                        {e.approval_id && <Badge className="badge-neutral">Approved</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-muted">{e.description ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(e.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
