'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Soft delete — DELETE moves the tender to 'cancelled'; the row is kept. */
export function CancelTenderButton({ tenderId }: { tenderId: string }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/tenders/${tenderId}`, { method: 'DELETE' })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not cancel the tender.')
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
        Cancel tender
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-slate/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-brand-slate">Cancel this tender?</h3>
            <p className="mt-2 text-sm text-text-muted">
              The tender moves to Cancelled and drops out of the active list. Nothing is deleted —
              bids and documents stay attached, and cancelled is a final state.
            </p>
            {error && <p className="mt-3 text-xs text-status-danger">⚠ {error}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirming(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted hover:bg-surface-bg"
              >
                Keep it
              </button>
              <button
                onClick={cancel}
                disabled={pending}
                className="rounded-lg bg-status-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-status-danger disabled:opacity-60"
              >
                {pending ? 'Cancelling…' : 'Cancel tender'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
