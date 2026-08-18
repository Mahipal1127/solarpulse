import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceLead } from '@/lib/services/finance'
import { getBudgetsWithSpend, getDepartmentOptions } from '@/lib/finance/dashboard'
import { Card, CardHeader, Badge, EmptyState, ProgressBar } from '@/components/ui/primitives'
import { BudgetForm } from '@/components/finance/BudgetForm'
import { formatCurrency, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Budgets and their actual spend. Spend is computed AT QUERY TIME (getBudgetsWithSpend) from
 * expenses + purchase bills over each budget's period — never a stored total, so it cannot
 * drift. Creating a budget is lead/CEO only (the form only renders for them; the service
 * re-checks). Every Finance member can see the budgets and their utilisation.
 */
export default async function BudgetsPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const lead = isFinanceLead(user)

  const [budgets, departments] = await Promise.all([
    getBudgetsWithSpend(user.organization_id),
    lead ? getDepartmentOptions(user.organization_id) : Promise.resolve([]),
  ])

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Budgets</h1>
        <p className="mt-1 text-sm text-text-muted">
          Allocations by department and period. Spend is calculated live from expenses and bills —
          it is never entered by hand.
        </p>
      </header>

      {lead && (
        <Card>
          <CardHeader
            title="New budget"
            subtitle="Allocations are CEO-approved. Link the approval when you create one."
          />
          <div className="px-5 py-4">
            <BudgetForm departments={departments} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Allocations" subtitle={`${budgets.length} shown`} />
        {budgets.length === 0 ? (
          <EmptyState
            title="No budgets yet"
            description={
              lead
                ? 'Create a budget above to start tracking spend against allocation.'
                : 'Budgets set by the Finance lead appear here.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {budgets.map((b) => {
              const pct = b.allocated_amount > 0 ? (b.spent / b.allocated_amount) * 100 : 0
              const over = b.spent > b.allocated_amount
              return (
                <li key={b.id} className="px-5 py-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-brand-slate">
                        {b.department_name ?? 'Org-wide'}
                      </p>
                      <p className="text-xs text-text-muted">
                        {formatDate(b.period_start)} – {formatDate(b.period_end)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-brand-slate">
                        {formatCurrency(b.spent)}{' '}
                        <span className="font-normal text-text-muted">
                          / {formatCurrency(b.allocated_amount)}
                        </span>
                      </p>
                      <Badge className={over ? 'badge-danger' : pct >= 80 ? 'badge-warning' : 'badge-success'}>
                        {Math.round(pct)}% used
                      </Badge>
                    </div>
                  </div>
                  <div className="mt-3">
                    <ProgressBar value={pct} />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>
    </div>
  )
}
