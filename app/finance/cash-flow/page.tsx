import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { getCashFlowSeries, getCashFlowEntries } from '@/lib/finance/dashboard'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { CashFlowChart } from '@/components/finance/CashFlowChart'
import {
  CASH_FLOW_TYPE_LABELS,
  CASH_FLOW_TYPE_STYLES,
  formatCashFlowSource,
  formatCurrency,
  formatDate,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

const WINDOW_DAYS = 90

/**
 * Cash flow over the last 90 days. The daily inflow/outflow series (getCashFlowSeries) is an
 * aggregate financial read, so it is logged even for the CEO. Entries are the raw movements
 * behind the chart — each is the audit trail of a receipt, vendor payment, expense, subsidy,
 * or tax payment. RLS scopes which entries a viewer sees.
 */
export default async function CashFlowPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])

  const [series, entries] = await Promise.all([
    getCashFlowSeries(user, WINDOW_DAYS),
    getCashFlowEntries(WINDOW_DAYS),
  ])

  const totalIn = entries.filter((e) => e.entry_type === 'inflow').reduce((s, e) => s + e.amount, 0)
  const totalOut = entries
    .filter((e) => e.entry_type === 'outflow')
    .reduce((s, e) => s + e.amount, 0)
  const net = totalIn - totalOut

  const recent = [...entries].reverse().slice(0, 50)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Cash Flow</h1>
        <p className="mt-1 text-sm text-text-muted">
          Money in and out over the last {WINDOW_DAYS} days. Every entry is posted automatically
          when a receipt, payment, or expense is recorded.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Inflow (90d)" value={formatCurrency(totalIn)} tone="success" />
        <StatCard label="Outflow (90d)" value={formatCurrency(totalOut)} tone="danger" />
        <StatCard
          label="Net (90d)"
          value={formatCurrency(net)}
          tone={net >= 0 ? 'brand' : 'danger'}
        />
      </div>

      <Card>
        <CardHeader title="Daily movement" subtitle="Inflow vs outflow" />
        <div className="px-5 py-4">
          <CashFlowChart data={series} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent entries" subtitle={`${recent.length} of ${entries.length}`} />
        {recent.length === 0 ? (
          <EmptyState
            title="No cash movement yet"
            description="Entries appear here as receipts, payments, and expenses are recorded."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Direction</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {recent.map((e) => (
                  <tr key={e.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-text-muted">{formatDate(e.entry_date)}</td>
                    <td className="px-4 py-3">
                      <Badge className={CASH_FLOW_TYPE_STYLES[e.entry_type]}>
                        {CASH_FLOW_TYPE_LABELS[e.entry_type]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted">{formatCashFlowSource(e.source)}</td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${
                        e.entry_type === 'inflow' ? 'text-status-success' : 'text-status-danger'
                      }`}
                    >
                      {e.entry_type === 'inflow' ? '+' : '−'}
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
