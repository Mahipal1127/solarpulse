'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/primitives'
import { formatCurrency, PO_STATUS_STYLES, PO_STATUS_LABELS, PO_STATUS_SHORT_LABELS } from '@/lib/format'
import { PO_TRANSITIONS, PO_STATUS_ORDER } from '@/lib/distribution/constants'
import type { PurchaseOrder, PurchaseOrderStatus } from '@/lib/types'

/**
 * The purchase order status rail, and the controls for moving along it.
 *
 * The approval gate is the point of this component. Distribution can move a PO
 * draft -> pending_finance_approval, and once approved, approved -> ordered ->
 * partially_received -> received. It cannot approve: 'approved' is filtered out of
 * the buttons offered here, and the PATCH endpoint's status vocabulary excludes it
 * anyway.
 *
 * None of that is what actually enforces the gate. Hiding a button is a courtesy
 * to the user; the enforcement is the route guard, the RLS policy, and the
 * enforce_po_approval_authority() trigger, each of which would refuse a
 * hand-crafted request that got this far.
 */
export function POStatusTracker({
  purchaseOrder,
  canOperate,
  canApprove,
  approverLabel,
}: {
  purchaseOrder: PurchaseOrder
  /** Distribution member: may move the PO everywhere except into 'approved'. */
  canOperate: boolean
  /** Finance or the CEO: may execute the one transition Distribution cannot. */
  canApprove: boolean
  /** Who approved, once someone has. */
  approverLabel?: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<PurchaseOrderStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<PurchaseOrderStatus | null>(null)

  const status = purchaseOrder.status
  const cancelled = status === 'cancelled'

  // Everything reachable from here, minus approval — that is Finance's button
  // below, on its own endpoint.
  const operatorMoves = (PO_TRANSITIONS[status] ?? []).filter((s) => s !== 'approved')
  const awaitingApproval = status === 'pending_finance_approval'

  async function move(next: PurchaseOrderStatus) {
    setBusy(next)
    setError(null)

    const res = await fetch(`/api/purchase-orders/${purchaseOrder.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    const body = await res.json().catch(() => ({}))
    setBusy(null)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the order.')
      return
    }

    setConfirming(null)
    router.refresh()
  }

  async function approve() {
    setBusy('approved')
    setError(null)

    // A separate endpoint, not a status PATCH: approval is a different authority
    // with a different guard, and the trigger stamps approved_by from the session
    // rather than trusting anything sent here.
    const res = await fetch(`/api/purchase-orders/${purchaseOrder.id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })

    const body = await res.json().catch(() => ({}))
    setBusy(null)

    if (!res.ok) {
      setError(body.error ?? 'Could not approve the order.')
      return
    }

    setConfirming(null)
    router.refresh()
  }

  const currentIndex = PO_STATUS_ORDER.indexOf(status)

  return (
    <div className="space-y-4">
      {/* Progress rail. Cancelled is not a step on it — a cancelled order left the
          path rather than advancing along it — so it shows as a banner instead. */}
      {cancelled ? (
        <div className="rounded-lg border border-status-danger/25 bg-status-danger/5 px-4 py-3">
          <p className="text-sm font-medium text-status-danger">This purchase order was cancelled.</p>
        </div>
      ) : (
        <ol className="flex flex-wrap items-center gap-1.5">
          {PO_STATUS_ORDER.map((step, index) => {
            const done = index < currentIndex
            const current = index === currentIndex
            return (
              <li key={step} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                    current
                      ? PO_STATUS_STYLES[step]
                      : done
                        ? 'bg-status-success/5 text-status-success ring-status-success/15'
                        : 'bg-surface-bg text-text-muted/60 ring-border-subtle'
                  }`}
                >
                  {done && <Check className="h-3 w-3" />}
                  {PO_STATUS_SHORT_LABELS[step]}
                </span>
                {index < PO_STATUS_ORDER.length - 1 && (
                  <span
                    className={`h-px w-4 ${index < currentIndex ? 'bg-status-success/60' : 'bg-surface-bg'}`}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge className={PO_STATUS_STYLES[status]}>{PO_STATUS_LABELS[status]}</Badge>
        {purchaseOrder.approved_at && (
          <span className="inline-flex items-center gap-1 text-xs text-status-success">
            <ShieldCheck className="h-3.5 w-3.5" />
            Approved{approverLabel ? ` by ${approverLabel}` : ''}
          </span>
        )}
      </div>

      {/* Finance's queue notice, shown to whoever is looking. For a Distribution
          member this explains why there is nothing they can do next. */}
      {awaitingApproval && !canApprove && (
        <p className="rounded-lg border border-status-warning/25 bg-status-warning/5 px-3 py-2 text-xs text-status-warning">
          Waiting on Finance. Material cannot be ordered until this is approved, and Distribution
          cannot approve its own order.
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {error}</p>
      )}

      {/* Finance's approval action. */}
      {awaitingApproval && canApprove && (
        <div className="rounded-lg border border-status-info/25 bg-status-info/5 p-4">
          <p className="text-sm text-status-info">
            Approve <strong>{purchaseOrder.po_number}</strong> for{' '}
            <strong>{formatCurrency(purchaseOrder.total_amount)}</strong>? Distribution can order the
            material once this is signed off.
          </p>
          <button
            onClick={approve}
            disabled={busy !== null}
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-status-info px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-status-info disabled:opacity-60"
          >
            <ShieldCheck className="h-4 w-4" />
            {busy === 'approved' ? 'Approving…' : 'Approve order'}
          </button>
        </div>
      )}

      {/* Distribution's moves. */}
      {canOperate && operatorMoves.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Move this order
          </p>
          <div className="flex flex-wrap gap-2">
            {operatorMoves.map((next) => {
              const destructive = next === 'cancelled'
              const isConfirming = confirming === next

              if (destructive && isConfirming) {
                return (
                  <span key={next} className="flex items-center gap-2">
                    <button
                      onClick={() => move(next)}
                      disabled={busy !== null}
                      className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-status-danger disabled:opacity-60"
                    >
                      {busy === next ? 'Cancelling…' : 'Confirm cancel'}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
                    >
                      Keep it
                    </button>
                  </span>
                )
              }

              return (
                <button
                  key={next}
                  onClick={() => (destructive ? setConfirming(next) : move(next))}
                  disabled={busy !== null}
                  className={
                    destructive
                      ? 'rounded-lg border border-status-danger/25 px-4 py-2 text-sm font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-60'
                      : 'rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60'
                  }
                >
                  {busy === next ? 'Saving…' : `Mark ${PO_STATUS_LABELS[next].toLowerCase()}`}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {canOperate && operatorMoves.length === 0 && !awaitingApproval && (
        <p className="text-xs text-text-muted">
          {status === 'received'
            ? 'This order is complete.'
            : 'No further moves from here.'}
        </p>
      )}
    </div>
  )
}
