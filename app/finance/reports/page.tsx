import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceLead } from '@/lib/services/finance'
import { getProfitAndLoss, getBalanceSheet } from '@/lib/finance/dashboard'
import { Card, CardHeader, StatCard, EmptyState } from '@/components/ui/primitives'
import { ReportRangeFilter } from '@/components/finance/ReportRangeFilter'
import { formatCurrency, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Reports — P&L and Balance Sheet. SENSITIVE: company-wide financial aggregates, so this is
 * the Finance-lead / CEO tier, mirroring HR's Payroll page. The gate is server-side and the
 * figures are rendered OUT ENTIRELY for a plain Finance Executive — nothing below the
 * `if (!lead)` return is ever fetched, so no aggregate reaches their browser. Backed by the
 * service layer (both report helpers log the access via logSensitiveAccess) and RLS.
 *
 * Both statements are computed at query time from the underlying rows and are clearly
 * labelled approximate — this is a management view, not audited accounts.
 */
export default async function ReportsPage(props: PageProps<'/finance/reports'>) {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const lead = isFinanceLead(user)

  // A plain Finance Executive gets a notice and NOTHING else — the aggregates are never read.
  if (!lead) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Reports</h1>
        </header>
        <Card>
          <EmptyState
            title="Restricted"
            description="Profit & loss and the balance sheet are visible only to the Finance lead and CEO. Ask your lead if you need a figure."
          />
        </Card>
      </div>
    )
  }

  const searchParams = await props.searchParams
  const { from, to } = resolveRange(asString(searchParams.from), asString(searchParams.to))

  const [pnl, balance] = await Promise.all([
    getProfitAndLoss(user, from, to),
    getBalanceSheet(user),
  ])

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Reports</h1>
        <p className="mt-1 text-sm text-text-muted">
          A management view of profit & loss and financial position. Computed live from
          invoices, expenses, bills, and cash flow — approximate, not audited accounts. Every
          view is logged.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Profit & Loss"
          subtitle={`${formatDate(pnl.from)} – ${formatDate(pnl.to)}`}
          action={<ReportRangeFilter from={from} to={to} />}
        />
        <div className="grid grid-cols-1 gap-px bg-border-subtle sm:grid-cols-2">
          <PnlRow label="Revenue (invoiced, excl. GST)" value={pnl.revenue} />
          <PnlRow label="GST collected" value={pnl.gstCollected} muted />
          <PnlRow label="Expenses" value={-pnl.expenses} />
          <PnlRow label="Purchases (excl. GST)" value={-pnl.purchases} />
          <PnlRow label="GST paid (input)" value={pnl.gstPaid} muted />
          <PnlRow label="Net profit" value={pnl.netProfit} strong />
        </div>
      </Card>

      <Card>
        <CardHeader title="Balance Sheet" subtitle="Snapshot as of now" />
        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-3">
          <StatCard
            label="Receivables"
            value={formatCurrency(balance.receivables)}
            hint="Outstanding invoice balances"
            tone="brand"
          />
          <StatCard
            label="Payables"
            value={formatCurrency(balance.payables)}
            hint="Outstanding bill balances"
            tone={balance.payables > 0 ? 'warning' : 'default'}
          />
          <StatCard
            label="Cash position"
            value={formatCurrency(balance.cashPosition)}
            hint="Net inflow − outflow, all time"
            tone={balance.cashPosition >= 0 ? 'success' : 'danger'}
          />
        </div>
      </Card>
    </div>
  )
}

function PnlRow({
  label,
  value,
  strong,
  muted,
}: {
  label: string
  value: number
  strong?: boolean
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between gap-3 bg-surface-card px-5 py-3">
      <span className={`text-sm ${muted ? 'text-text-muted' : 'text-brand-slate'}`}>{label}</span>
      <span
        className={`tabular-nums ${
          strong
            ? `text-lg font-semibold ${value < 0 ? 'text-status-danger' : 'text-brand-slate'}`
            : `text-sm ${value < 0 ? 'text-status-danger' : 'text-brand-slate'}`
        }`}
      >
        {formatCurrency(value)}
      </span>
    </div>
  )
}

/** Defaults to the current month to date when no range is supplied. Dates are 'YYYY-MM-DD'. */
function resolveRange(from?: string, to?: string): { from: string; to: string } {
  const isDate = (v: string | undefined): v is string => !!v && /^\d{4}-\d{2}-\d{2}$/.test(v)
  const now = new Date()
  const firstOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
  const today = now.toISOString().slice(0, 10)
  return {
    from: isDate(from) ? from : firstOfMonth,
    to: isDate(to) ? to : today,
  }
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
