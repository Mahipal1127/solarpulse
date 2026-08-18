import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getInvoice, getReceiptsForInvoice } from '@/lib/finance/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { ReceiptForm } from '@/components/finance/ReceiptForm'
import { InvoiceStatusControl } from '@/components/finance/InvoiceStatusControl'
import {
  INVOICE_TYPE_LABELS,
  formatCurrency,
  formatDate,
  formatPaymentMethod,
  daysOverdue,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * One invoice with its receipts. RLS admits the row only for the issuer (exec) or a
 * lead/CEO, so an exec cannot open a colleague's invoice by guessing the URL. Recording a
 * receipt runs the one-transaction RPC (receipt + status recompute + cash-flow inflow).
 * A read-only viewer (CEO) sees the figures and history but no receipt form or status
 * control.
 */
export default async function InvoiceDetailPage(props: PageProps<'/finance/invoices/[invoiceId]'>) {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const { invoiceId } = await props.params
  const readOnly = !isFinanceMember(user)

  const invoice = await getInvoice(invoiceId)
  if (!invoice) notFound()

  const receipts = await getReceiptsForInvoice(invoiceId)
  const received = receipts.reduce((s, r) => s + r.amount_received, 0)
  const balance = invoice.total_amount - received
  const overdue = daysOverdue(invoice.due_date, invoice.status)

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/finance/invoices" className="hover:text-brand-gold">
            Invoices
          </Link>
          <span>/</span>
          <span>{invoice.invoice_number}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-brand-slate">{invoice.invoice_number}</h1>
          <InvoiceStatusControl
            invoiceId={invoice.id}
            status={invoice.status}
            readOnly={readOnly}
          />
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Detail label="Customer" value={invoice.customer?.name ?? '—'} />
        <Detail label="Type" value={INVOICE_TYPE_LABELS[invoice.invoice_type]} />
        <Detail
          label="Due date"
          value={invoice.due_date ? formatDate(invoice.due_date) : '—'}
          hint={overdue > 0 ? `${overdue} day${overdue === 1 ? '' : 's'} overdue` : undefined}
          hintDanger={overdue > 0}
        />
        <Detail label="Amount (excl. GST)" value={formatCurrency(invoice.amount)} />
        <Detail label="GST" value={formatCurrency(invoice.gst_amount)} />
        <Detail label="Total" value={formatCurrency(invoice.total_amount)} strong />
        <Detail label="Received" value={formatCurrency(received)} />
        <Detail
          label="Balance due"
          value={formatCurrency(balance)}
          strong
          hintDanger={balance > 0}
        />
      </div>

      {!readOnly && balance > 0 && (
        <Card>
          <CardHeader
            title="Record a receipt"
            subtitle="Saves the receipt, updates the invoice status, and posts a cash-flow inflow — one transaction."
          />
          <div className="px-5 py-4">
            <ReceiptForm invoiceId={invoice.id} balanceDue={balance} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Receipts" subtitle={`${receipts.length} recorded`} />
        {receipts.length === 0 ? (
          <EmptyState
            title="No receipts yet"
            description="Payments recorded against this invoice show up here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 text-right font-semibold">Amount</th>
                  <th className="px-4 py-3 font-semibold">Method</th>
                  <th className="px-4 py-3 font-semibold">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {receipts.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-text-muted">{formatDate(r.received_date)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(r.amount_received)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {formatPaymentMethod(r.payment_method)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{r.reference_number ?? '—'}</td>
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

function Detail({
  label,
  value,
  hint,
  hintDanger,
  strong,
}: {
  label: string
  value: string
  hint?: string
  hintDanger?: boolean
  strong?: boolean
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p
        className={`mt-1 tabular-nums ${strong ? 'text-lg font-semibold text-brand-slate' : 'text-sm text-brand-slate'}`}
      >
        {value}
      </p>
      {hint && (
        <p className={`mt-0.5 text-xs ${hintDanger ? 'text-status-danger' : 'text-text-muted'}`}>
          {hint}
        </p>
      )}
    </div>
  )
}
