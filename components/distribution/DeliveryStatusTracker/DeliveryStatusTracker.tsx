'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, AlertTriangle } from 'lucide-react'
import { Badge } from '@/components/ui/primitives'
import {
  formatDateTime,
  daysSince,
  isDispatchRunningLate,
  DISPATCH_STATUS_STYLES,
  DISPATCH_STATUS_LABELS,
} from '@/lib/format'
import {
  DISPATCH_TRANSITIONS,
  DISPATCH_STATUS_ORDER,
  DISPATCH_IN_TRANSIT_WARNING_DAYS,
} from '@/lib/distribution/constants'
import type { MaterialDispatch, DispatchStatus } from '@/lib/types'

/**
 * Delivery status rail and controls.
 *
 * This is a manually-updated field, not a tracking integration — there is no GPS
 * or carrier feed behind it, and nothing here polls. Someone marks the lorry as
 * having left, and later as having arrived.
 *
 * The two timestamps are stamped server-side when the status moves, so a client
 * clock cannot backdate a departure. That matters because the "running late"
 * warning is measured from dispatched_at: a forgeable value there would let a late
 * dispatch look punctual.
 */
export function DeliveryStatusTracker({
  dispatch,
  canOperate,
}: {
  dispatch: MaterialDispatch
  canOperate: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<DispatchStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<DispatchStatus | null>(null)

  const status = dispatch.status
  const cancelled = status === 'cancelled'
  const moves = DISPATCH_TRANSITIONS[status] ?? []
  const runningLate = isDispatchRunningLate(dispatch)

  async function move(next: DispatchStatus) {
    setBusy(next)
    setError(null)

    const res = await fetch(`/api/dispatches/${dispatch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    const body = await res.json().catch(() => ({}))
    setBusy(null)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the dispatch.')
      return
    }

    setConfirming(null)
    router.refresh()
  }

  // 'delayed' is a sideways state rather than a step, so it is not on the rail —
  // the rail shows the journey, and a delayed lorry is still somewhere on it.
  const railIndex = DISPATCH_STATUS_ORDER.indexOf(
    status === 'delayed' ? 'in_transit' : (status as (typeof DISPATCH_STATUS_ORDER)[number])
  )

  return (
    <div className="space-y-4">
      {cancelled ? (
        <div className="rounded-lg border border-status-danger/25 bg-status-danger/5 px-4 py-3">
          <p className="text-sm font-medium text-status-danger">This dispatch was cancelled.</p>
          <p className="mt-1 text-xs text-status-danger">
            Any allocations it had claimed were released back to the project, so that material can
            be sent on a new dispatch.
          </p>
        </div>
      ) : (
        <ol className="flex flex-wrap items-center gap-1.5">
          {DISPATCH_STATUS_ORDER.map((step, index) => {
            const done = index < railIndex
            const current = index === railIndex
            return (
              <li key={step} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                    current
                      ? DISPATCH_STATUS_STYLES[status === 'delayed' ? 'delayed' : step]
                      : done
                        ? 'bg-status-success/5 text-status-success ring-status-success/15'
                        : 'bg-surface-bg text-text-muted/60 ring-border-subtle'
                  }`}
                >
                  {done && <Check className="h-3 w-3" />}
                  {current && status === 'delayed'
                    ? DISPATCH_STATUS_LABELS.delayed
                    : DISPATCH_STATUS_LABELS[step]}
                </span>
                {index < DISPATCH_STATUS_ORDER.length - 1 && (
                  <span
                    className={`h-px w-4 ${index < railIndex ? 'bg-status-success/60' : 'bg-surface-bg'}`}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Badge className={DISPATCH_STATUS_STYLES[status]}>
          {DISPATCH_STATUS_LABELS[status]}
        </Badge>
        {dispatch.dispatched_at && (
          <span className="text-xs text-text-muted">
            Left {formatDateTime(dispatch.dispatched_at)}
          </span>
        )}
        {dispatch.delivered_at && (
          <span className="text-xs text-status-success">
            Delivered {formatDateTime(dispatch.delivered_at)}
          </span>
        )}
      </div>

      {/* Derived from the clock, never stored — which is why a dispatch can be
          flagged here and still read 'in_transit' in the database. Marking it
          'delayed' stays a judgement someone records deliberately. */}
      {runningLate && (
        <div className="flex items-start gap-2 rounded-lg border border-status-warning/25 bg-status-warning/5 px-3 py-2.5">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" />
          <p className="text-xs text-status-warning">
            In transit for {daysSince(dispatch.dispatched_at!)} days, over the{' '}
            {DISPATCH_IN_TRANSIT_WARNING_DAYS}-day threshold. Worth a call to the driver — mark it
            delayed if it is genuinely held up.
          </p>
        </div>
      )}

      {error && <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {error}</p>}

      {canOperate && moves.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Update delivery status
          </p>
          <div className="flex flex-wrap gap-2">
            {moves.map((next) => {
              const destructive = next === 'cancelled'
              const primary = next === 'in_transit' || next === 'delivered'

              if (destructive && confirming === next) {
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
                      : primary
                        ? 'rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60'
                        : 'rounded-lg border border-status-warning/30 bg-status-warning/5 px-4 py-2 text-sm font-medium text-status-warning transition-colors hover:bg-status-warning/10 disabled:opacity-60'
                  }
                >
                  {busy === next
                    ? 'Saving…'
                    : next === 'in_transit'
                      ? 'Mark in transit'
                      : next === 'delivered'
                        ? 'Mark delivered'
                        : next === 'delayed'
                          ? 'Flag as delayed'
                          : 'Cancel dispatch'}
                </button>
              )
            })}
          </div>

          {confirming === 'cancelled' && (
            <p className="text-xs text-text-muted">
              Cancelling releases this dispatch&apos;s allocations back to the project so the
              material can go out again later.
            </p>
          )}
        </div>
      )}

      {canOperate && moves.length === 0 && !cancelled && (
        <p className="text-xs text-text-muted">This dispatch is complete.</p>
      )}
    </div>
  )
}
