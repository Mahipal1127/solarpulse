import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { getOutstandingInvoices, getOutstandingBills } from '@/lib/finance/dashboard'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  PURCHASE_BILL_STATUS_LABELS,
  PURCHASE_BILL_STATUS_STYLES,
  formatCurrency,
  formatDate,
  daysOverdue,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Outstanding money — receivables (unpaid invoices) and payables (unpaid bills) on two tabs.
 * Balances come from the read helpers, which subtract cumulative receipts / payments from the
 * generated total. RLS scopes what each viewer sees. The tab is URL-driven so it is
 * shareable and survives refresh.
 */
export default async function OutstandingPage(props: PageProps<'/finance/outstanding'>) {
  // Guard runs for its redirect side effect; the rows are scoped by RLS, not by this call.
  await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const searchParams = await props.searchParams
  const tab = asString(searchParams.tab) === 'payables' ? 'payables' : 'receivables'

  const [invoices, bills] = await Promise.all([
    getOutstandingInvoices(),
    getOutstandingBills(),
  ])

  const totalReceivable = invoices.reduce((s, i) => s + i.balance, 0)
  const totalPayable = bills.reduce((s, b) => s + b.balance, 0)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Outstanding</h1>
        <p className="mt-1 text-sm text-text-muted">
          What customers still owe and what you still owe vendors. Balances update as receipts and
          payments are recorded.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <StatCard
          label="Receivable"
          value={formatCurrency(totalReceivable)}
          hint={`${invoices.length} invoice${invoices.length === 1 ? '' : 's'}`}
          tone="brand"
        />
        <StatCard
          label="Payable"
          value={formatCurrency(totalPayable)}
          hint={`${bills.length} bill${bills.length === 1 ? '' : 's'}`}
          tone={totalPayable > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="flex gap-2">
        <TabLink label="Receivables" href="/finance/outstanding?tab=receivables" active={tab === 'receivables'} />
        <TabLink label="Payables" href="/finance/outstanding?tab=payables" active={tab === 'payables'} />
      </div>

      {tab === 'receivables' ? (
        <Card>
          <CardHeader title="Unpaid invoices" subtitle={`${invoices.length} shown`} />
          {invoices.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="Every invoice is settled." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-3 font-semibold">Invoice</th>
                    <th className="px-4 py-3 font-semibold">Customer</th>
                    <th className="px-4 py-3 font-semibold">Due</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-right font-semibold">Balance</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {invoices.map((inv) => {
                    const overdue = daysOverdue(inv.due_date, inv.status)
                    return (
                      <tr key={inv.id} className="transition-colors hover:bg-surface-bg">
                        <td className="px-4 py-3">
                          <Link
                            href={`/finance/invoices/${inv.id}`}
                            className="font-medium text-brand-slate hover:text-brand-gold"
                          >
                            {inv.invoice_number}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-text-muted">{inv.customer?.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          <span className="text-text-muted">
                            {inv.due_date ? formatDate(inv.due_date) : '—'}
                          </span>
                          {overdue > 0 && (
                            <span className="ml-2 text-xs font-medium text-status-danger">
                              {overdue}d overdue
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                          {formatCurrency(inv.total_amount)}
                        </td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                          {formatCurrency(inv.balance)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge className={INVOICE_STATUS_STYLES[inv.status]}>
                            {INVOICE_STATUS_LABELS[inv.status]}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Unpaid bills" subtitle={`${bills.length} shown`} />
          {bills.length === 0 ? (
            <EmptyState title="Nothing outstanding" description="Every bill is settled." />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                    <th className="px-4 py-3 font-semibold">Vendor</th>
                    <th className="px-4 py-3 font-semibold">Bill no.</th>
                    <th className="px-4 py-3 font-semibold">Due</th>
                    <th className="px-4 py-3 text-right font-semibold">Total</th>
                    <th className="px-4 py-3 text-right font-semibold">Balance</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {bills.map((b) => (
                    <tr key={b.id} className="transition-colors hover:bg-surface-bg">
                      <td className="px-4 py-3">
                        <Link
                          href={`/finance/purchases/${b.id}`}
                          className="font-medium text-brand-slate hover:text-brand-gold"
                        >
                          {b.vendor_name}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-text-muted">{b.bill_number ?? '—'}</td>
                      <td className="px-4 py-3 text-text-muted">
                        {b.due_date ? formatDate(b.due_date) : '—'}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                        {formatCurrency(b.total_amount)}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                        {formatCurrency(b.balance)}
                      </td>
                      <td className="px-4 py-3">
                        <Badge className={PURCHASE_BILL_STATUS_STYLES[b.status]}>
                          {PURCHASE_BILL_STATUS_LABELS[b.status]}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function TabLink({ label, href, active }: { label: string; href: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`rounded-full px-4 py-1.5 text-xs font-medium transition-colors ${
        active
          ? 'bg-brand-slate text-white'
          : 'border border-border-subtle text-text-muted hover:bg-surface-bg'
      }`}
    >
      {label}
    </Link>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
