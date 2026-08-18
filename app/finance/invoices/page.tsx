import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getInvoices } from '@/lib/finance/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import {
  INVOICE_STATUS_LABELS,
  INVOICE_STATUS_STYLES,
  INVOICE_TYPE_LABELS,
  formatCurrency,
  formatDate,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Invoices list. RLS decides the rows: a Finance exec sees only invoices they issued, a
 * lead/CEO the whole department. The "New invoice" action is hidden for a read-only viewer
 * (CEO). Each row links to the detail page where receipts are recorded.
 */
export default async function InvoicesPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const canWrite = isFinanceMember(user)
  const invoices = await getInvoices()

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Invoices</h1>
          <p className="mt-1 text-sm text-text-muted">
            Bill customers for closed deals and completed installations. Payment is recorded as
            receipts against an invoice.
          </p>
        </div>
        {canWrite && (
          <Link
            href="/finance/invoices/new"
            className="shrink-0 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            New invoice
          </Link>
        )}
      </header>

      <Card>
        <CardHeader title="All invoices" subtitle={`${invoices.length} shown`} />
        {invoices.length === 0 ? (
          <EmptyState
            title="No invoices yet"
            description="Invoices you raise appear here. Start from a completed deal or installation, or create a standalone one."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Invoice</th>
                  <th className="px-4 py-3 font-semibold">Customer</th>
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {invoices.map((inv) => (
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
                    <td className="px-4 py-3 text-text-muted">
                      {INVOICE_TYPE_LABELS[inv.invoice_type]}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(inv.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {inv.due_date ? formatDate(inv.due_date) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={INVOICE_STATUS_STYLES[inv.status]}>
                        {INVOICE_STATUS_LABELS[inv.status]}
                      </Badge>
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
