import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getPurchaseBill, getVendorPaymentsForBill } from '@/lib/finance/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { VendorPaymentForm } from '@/components/finance/VendorPaymentForm'
import {
  PURCHASE_BILL_STATUS_LABELS,
  PURCHASE_BILL_STATUS_STYLES,
  formatCurrency,
  formatDate,
  formatPaymentMethod,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * One purchase bill with its payments. RLS admits the row only for the recorder (exec) or a
 * lead/CEO. Recording a payment runs the one-transaction RPC (payment + bill-status recompute
 * + cash-flow outflow). A read-only viewer sees figures and history but no payment form.
 */
export default async function PurchaseBillDetailPage(
  props: PageProps<'/finance/purchases/[billId]'>
) {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const { billId } = await props.params
  const readOnly = !isFinanceMember(user)

  const bill = await getPurchaseBill(billId)
  if (!bill) notFound()

  const payments = await getVendorPaymentsForBill(billId)
  const paid = payments.reduce((s, p) => s + p.amount_paid, 0)
  const balance = bill.total_amount - paid

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/finance/purchases" className="hover:text-brand-gold">
            Purchases
          </Link>
          <span>/</span>
          <span>{bill.vendor_name}</span>
        </div>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-brand-slate">{bill.vendor_name}</h1>
          <Badge className={PURCHASE_BILL_STATUS_STYLES[bill.status]}>
            {PURCHASE_BILL_STATUS_LABELS[bill.status]}
          </Badge>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Detail label="Bill number" value={bill.bill_number ?? '—'} />
        <Detail label="Due date" value={bill.due_date ? formatDate(bill.due_date) : '—'} />
        <Detail label="Amount (excl. GST)" value={formatCurrency(bill.amount)} />
        <Detail label="GST" value={formatCurrency(bill.gst_amount)} />
        <Detail label="Total" value={formatCurrency(bill.total_amount)} strong />
        <Detail label="Paid" value={formatCurrency(paid)} />
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
            title="Record a payment"
            subtitle="Saves the payment, updates the bill status, and posts a cash-flow outflow — one transaction."
          />
          <div className="px-5 py-4">
            <VendorPaymentForm billId={bill.id} balanceDue={balance} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Payments" subtitle={`${payments.length} recorded`} />
        {payments.length === 0 ? (
          <EmptyState
            title="No payments yet"
            description="Payments made against this bill show up here."
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
                {payments.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-text-muted">{formatDate(p.paid_date)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(p.amount_paid)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {formatPaymentMethod(p.payment_method)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{p.reference_number ?? '—'}</td>
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
  hintDanger,
  strong,
}: {
  label: string
  value: string
  hintDanger?: boolean
  strong?: boolean
}) {
  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card px-4 py-3">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p
        className={`mt-1 tabular-nums ${
          strong
            ? `text-lg font-semibold ${hintDanger ? 'text-status-danger' : 'text-brand-slate'}`
            : 'text-sm text-brand-slate'
        }`}
      >
        {value}
      </p>
    </div>
  )
}
