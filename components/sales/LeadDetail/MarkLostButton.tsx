'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Soft delete. DELETE moves the lead to 'lost' and keeps the row, so the
 * quotations and follow-ups attached to it stay auditable — same rule as
 * archiveTask() and cancelTender().
 */
export function MarkLostButton({ leadId }: { leadId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function markLost() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/leads/${leadId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: reason.trim() || undefined }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not mark the lead lost.')
      return
    }

    setConfirming(false)
    router.refresh()
  }

  return (
    <>
      <button
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-status-danger/25 bg-white px-4 py-2.5 text-sm font-medium text-status-danger transition-colors hover:bg-status-danger/5"
      >
        Mark lost
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-slate/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-brand-slate">Mark this lead lost?</h3>
            <p className="mt-2 text-sm text-text-muted">
              The lead drops out of the open pipeline. Nothing is deleted — quotations and
              follow-ups stay attached, and lost is a final state.
            </p>

            <div className="mt-4">
              <label
                htmlFor="lost-reason"
                className="block text-xs font-semibold uppercase tracking-wide text-text-muted"
              >
                Reason
              </label>
              <textarea
                id="lost-reason"
                rows={2}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Went with a competitor, budget pulled, no response."
                className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
              />
              <p className="mt-1 text-xs text-text-muted">
                Replaces the lead&apos;s notes, so the reason is visible on the record itself.
              </p>
            </div>

            {error && <p className="mt-3 text-xs text-status-danger">⚠ {error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted hover:bg-surface-bg"
              >
                Keep it open
              </button>
              <button
                onClick={markLost}
                disabled={pending}
                className="rounded-lg bg-status-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-status-danger disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Mark lost'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
