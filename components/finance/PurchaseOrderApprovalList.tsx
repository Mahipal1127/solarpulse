'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { EmptyState } from '@/components/ui/primitives'
import { formatCurrency, formatDate } from '@/lib/format'

export interface PendingPoApproval {
  id: string
  po_number: string
  vendor_name: string | null
  total_amount: number
  expected_delivery_date: string | null
  created_at: string
}

/**
 * The Finance-approval queue for Distribution purchase orders. Approving here POSTs to
 * /api/purchase-orders/[poId]/approve — the same hardened route Distribution's PO detail
 * page uses (guard + finance_approve_purchase_orders RLS + the enforce_po_approval_authority
 * trigger that stamps approved_by). This component only surfaces the queue and the button
 * inside the Finance module; it grants no new authority. readOnly (a CEO viewing) drops the
 * approve action but keeps the list and the link through to the full PO.
 */
export function PurchaseOrderApprovalList({
  orders,
  readOnly,
}: {
  orders: PendingPoApproval[]
  readOnly: boolean
}) {
  if (orders.length === 0) {
    return (
      <EmptyState
        title="Nothing awaiting approval"
        description="Purchase orders Distribution submits for Finance sign-off appear here."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-semibold">PO</th>
            <th className="px-4 py-3 font-semibold">Vendor</th>
            <th className="px-4 py-3 text-right font-semibold">Value</th>
            <th className="px-4 py-3 font-semibold">Expected delivery</th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {orders.map((po) => (
            <ApprovalRow key={po.id} order={po} readOnly={readOnly} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ApprovalRow({ order, readOnly }: { order: PendingPoApproval; readOnly: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function approve() {
    setPending(true)
    setError(null)
    let res: Response
    try {
      res = await fetch(`/api/purchase-orders/${order.id}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
    } catch {
      setPending(false)
      setError('Network error — the request never reached the server.')
      return
    }
    setPending(false)
    if (!res.ok) {
      // Read the body as text first so we surface the REAL reason even when it is
      // not the { error } JSON shape (e.g. an HTML error page or a redirect).
      const raw = await res.text().catch(() => '')
      let message = ''
      try {
        message = (JSON.parse(raw) as { error?: string }).error ?? ''
      } catch {
        message = raw.slice(0, 200)
      }
      setError(`Approve failed (HTTP ${res.status}): ${message || 'no response body'}`)
      return
    }
    router.refresh()
  }

  return (
    <tr className="transition-colors hover:bg-surface-bg">
      <td className="px-4 py-3">
        <Link
          href={`/distribution/purchase-orders/${order.id}`}
          className="font-medium text-brand-slate hover:text-brand-gold"
        >
          {order.po_number}
        </Link>
      </td>
      <td className="px-4 py-3 text-text-muted">{order.vendor_name ?? '—'}</td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
        {formatCurrency(order.total_amount)}
      </td>
      <td className="px-4 py-3 text-text-muted">
        {order.expected_delivery_date ? formatDate(order.expected_delivery_date) : '—'}
      </td>
      <td className="px-4 py-3 text-right">
        {readOnly ? (
          <Link
            href={`/distribution/purchase-orders/${order.id}`}
            className="text-xs font-medium text-brand-slate hover:text-brand-gold"
          >
            View →
          </Link>
        ) : (
          <div className="flex items-center justify-end gap-2">
            {error && <span className="text-xs text-status-danger">⚠ {error}</span>}
            <button
              onClick={approve}
              disabled={pending}
              className="rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
            >
              {pending ? 'Approving…' : 'Approve'}
            </button>
          </div>
        )}
      </td>
    </tr>
  )
}
