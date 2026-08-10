'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatCurrency,
  formatDate,
  isPurchaseOrderOverdue,
  PO_STATUS_STYLES,
  PO_STATUS_LABELS,
} from '@/lib/format'
import { PO_STATUS_ORDER } from '@/lib/distribution/constants'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/types'

export type PurchaseOrderRow = PurchaseOrder & {
  vendor: { name: string } | null
}

/**
 * Purchase order register with client-side filters.
 *
 * Every Distribution member sees every order — this module has no per-employee
 * ownership tier, so filtering here is display only, over rows RLS already chose
 * to return.
 */
export function PurchaseOrderList({
  purchaseOrders,
  readOnly,
  /**
   * Finance's view. Defaults the status filter to their queue, since an approver
   * arriving here almost always wants the orders waiting on them rather than the
   * whole register.
   */
  approverView = false,
}: {
  purchaseOrders: PurchaseOrderRow[]
  readOnly: boolean
  approverView?: boolean
}) {
  const [status, setStatus] = useState<string>(
    approverView ? 'pending_finance_approval' : ''
  )
  const [query, setQuery] = useState('')
  const [overdueOnly, setOverdueOnly] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return purchaseOrders.filter((po) => {
      if (status && po.status !== status) return false
      if (overdueOnly && !isPurchaseOrderOverdue(po)) return false
      if (!q) return true
      return (
        po.po_number.toLowerCase().includes(q) ||
        (po.vendor?.name ?? '').toLowerCase().includes(q)
      )
    })
  }, [purchaseOrders, status, query, overdueOnly])

  const overdueCount = purchaseOrders.filter(isPurchaseOrderOverdue).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search PO number or vendor"
          aria-label="Search purchase orders"
          className="min-w-52 flex-1 rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        >
          <option value="">All statuses</option>
          {[...PO_STATUS_ORDER, 'cancelled' as PurchaseOrderStatus].map((s) => (
            <option key={s} value={s}>
              {PO_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {overdueCount > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(e) => setOverdueOnly(e.target.checked)}
              className="h-4 w-4 rounded border-border-subtle text-brand-slate "
            />
            Overdue only ({overdueCount})
          </label>
        )}

        {!readOnly && (
          <Link
            href="/distribution/purchase-orders/new"
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            New order
          </Link>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={
            purchaseOrders.length === 0
              ? 'No purchase orders yet'
              : status === 'pending_finance_approval'
                ? 'Nothing waiting on Finance'
                : 'No orders match these filters'
          }
          description={
            purchaseOrders.length === 0
              ? 'Raise an order against a vendor to get material moving.'
              : 'Try a different status or search.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-white shadow-sm">
          <table className="min-w-full divide-y divide-border-subtle">
            <thead className="bg-surface-bg">
              <tr>
                <Th>PO Number</Th>
                <Th>Vendor</Th>
                <Th>Status</Th>
                <Th>Expected</Th>
                <Th className="text-right">Total</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.map((po) => {
                const overdue = isPurchaseOrderOverdue(po)
                return (
                  <tr key={po.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3">
                      <Link
                        href={`/distribution/purchase-orders/${po.id}`}
                        className="text-sm font-medium text-brand-slate hover:text-brand-slate"
                      >
                        {po.po_number}
                      </Link>
                      <span className="mt-0.5 block text-xs text-text-muted/60">
                        Raised {formatDate(po.created_at)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {po.vendor?.name ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={PO_STATUS_STYLES[po.status]}>
                          {PO_STATUS_LABELS[po.status]}
                        </Badge>
                        {overdue && (
                          <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/25">Overdue</Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {formatDate(po.expected_delivery_date)}
                    </td>
                    <td className="px-4 py-3 text-right text-sm font-semibold text-brand-slate">
                      {formatCurrency(po.total_amount)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted ${className}`}
    >
      {children}
    </th>
  )
}
