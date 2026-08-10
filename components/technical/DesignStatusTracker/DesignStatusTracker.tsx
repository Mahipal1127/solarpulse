'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, Send } from 'lucide-react'
import { Badge } from '@/components/ui/primitives'
import {
  DESIGN_STATUS_STYLES,
  DESIGN_STATUS_LABELS,
  DESIGN_STATUS_SHORT_LABELS,
} from '@/lib/format'
import { DESIGN_TRANSITIONS, DESIGN_STATUS_ORDER } from '@/lib/technical/constants'
import type { Design, DesignStatus } from '@/lib/types'

/**
 * The design status rail and its move buttons.
 *
 * Approving is deliberately not role-gated, unlike Distribution's Finance gate on a
 * purchase order. The blueprint names an approver for a PO and does not for a
 * design, and inventing a lead-only gate here would stall a solo engineer with
 * nobody above them. If the client does want design sign-off restricted to the
 * Technical lead, that belongs in a policy plus a trigger — the same three-layer
 * shape the PO gate uses — not in this component.
 *
 * Moving to 'sent_to_sales' creates nothing in Sales. It is a signal that the design
 * and its BOQ are ready to be quoted from, and a person in Sales acts on it. This
 * module does not reach into the quotations table.
 */
export function DesignStatusTracker({
  design,
  canOperate,
}: {
  design: Design
  canOperate: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<DesignStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<DesignStatus | null>(null)

  const status = design.status
  const moves = DESIGN_TRANSITIONS[status] ?? []

  async function move(next: DesignStatus) {
    setBusy(next)
    setError(null)

    const res = await fetch(`/api/designs/${design.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    const body = await res.json().catch(() => ({}))
    setBusy(null)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the design.')
      return
    }

    setConfirming(null)
    router.refresh()
  }

  const currentIndex = DESIGN_STATUS_ORDER.indexOf(status)

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap items-center gap-1.5">
        {DESIGN_STATUS_ORDER.map((step, index) => {
          const done = index < currentIndex
          const current = index === currentIndex
          return (
            <li key={step} className="flex items-center gap-1.5">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                  current
                    ? DESIGN_STATUS_STYLES[step]
                    : done
                      ? 'bg-status-success/5 text-status-success ring-status-success/15'
                      : 'bg-surface-bg text-text-muted/60 ring-border-subtle'
                }`}
              >
                {done && <Check className="h-3 w-3" />}
                {DESIGN_STATUS_SHORT_LABELS[step]}
              </span>
              {index < DESIGN_STATUS_ORDER.length - 1 && (
                <span
                  className={`h-px w-4 ${index < currentIndex ? 'bg-status-success/60' : 'bg-surface-bg'}`}
                />
              )}
            </li>
          )
        })}
      </ol>

      <Badge className={DESIGN_STATUS_STYLES[status]}>{DESIGN_STATUS_LABELS[status]}</Badge>

      {error && <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {error}</p>}

      {status === 'sent_to_sales' && (
        <div className="rounded-lg border border-status-success/25 bg-status-success/5 p-4">
          <p className="flex items-start gap-2 text-sm text-status-success">
            <Send className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Handed to Sales. They quote from these figures — nothing was created in Sales
              automatically, and this design is now frozen so a quotation cannot end up resting on
              numbers that changed underneath it. A revision is a new design.
            </span>
          </p>
        </div>
      )}

      {canOperate && moves.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Move this design
          </p>
          <div className="flex flex-wrap gap-2">
            {moves.map((next) => {
              /**
               * Sending to Sales is the one-way door: it freezes the design and it is
               * what someone else starts quoting from. Worth a confirmation, the same
               * treatment cancelling gets elsewhere.
               */
              const irreversible = next === 'sent_to_sales'
              const isConfirming = confirming === next

              if (irreversible && isConfirming) {
                return (
                  <span key={next} className="flex items-center gap-2">
                    <button
                      onClick={() => move(next)}
                      disabled={busy !== null}
                      className="rounded-lg bg-status-success px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-status-success disabled:opacity-60"
                    >
                      {busy === next ? 'Sending…' : 'Confirm — send to Sales'}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
                    >
                      Not yet
                    </button>
                  </span>
                )
              }

              return (
                <button
                  key={next}
                  onClick={() => (irreversible ? setConfirming(next) : move(next))}
                  disabled={busy !== null}
                  className={
                    next === 'draft'
                      ? 'rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60'
                      : 'rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60'
                  }
                >
                  {busy === next
                    ? 'Saving…'
                    : next === 'draft'
                      ? 'Send back to draft'
                      : next === 'sent_to_sales'
                        ? 'Send to Sales'
                        : `Mark ${DESIGN_STATUS_LABELS[next].toLowerCase()}`}
                </button>
              )
            })}
          </div>

          {confirming === 'sent_to_sales' && (
            <p className="text-xs text-text-muted">
              Once sent, the figures and BOQ are frozen — Sales may already be quoting from them.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
