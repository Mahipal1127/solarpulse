import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getPurchaseBills } from '@/lib/finance/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import {
  PURCHASE_BILL_STATUS_LABELS,
  PURCHASE_BILL_STATUS_STYLES,
  formatCurrency,
  formatDate,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Purchase bills (payables). Purchase ORDERS are Distribution's; a bill is Finance's record
 * of what a vendor invoiced, optionally against a PO. RLS scopes an exec to bills they
 * recorded, a lead/CEO to all. Each row links to the detail page where vendor payments are
 * recorded. "Record bill" is hidden for a read-only viewer.
 */
export default async function PurchasesPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const canWrite = isFinanceMember(user)
  const bills = await getPurchaseBills()

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Purchases</h1>
          <p className="mt-1 text-sm text-text-muted">
            Vendor bills and the payments made against them. Bills can reference a Distribution
            purchase order or stand alone.
          </p>
        </div>
        {canWrite && (
          <Link
            href="/finance/purchases/new"
            className="shrink-0 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            Record bill
          </Link>
        )}
      </header>

      <Card>
        <CardHeader title="All bills" subtitle={`${bills.length} shown`} />
        {bills.length === 0 ? (
          <EmptyState
            title="No bills yet"
            description="Vendor bills you record appear here until they are fully paid."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Vendor</th>
                  <th className="px-4 py-3 font-semibold">Bill no.</th>
                  <th className="px-4 py-3 text-right font-semibold">Total</th>
                  <th className="px-4 py-3 font-semibold">Due</th>
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
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(b.total_amount)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {b.due_date ? formatDate(b.due_date) : '—'}
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
    </div>
  )
}
