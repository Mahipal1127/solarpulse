'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

type Decision = 'approved' | 'rejected'

export function ApprovalDecisionButtons({
  approvalId,
  summary,
}: {
  approvalId: string
  summary: string
}) {
  const router = useRouter()
  const [pendingDecision, setPendingDecision] = useState<Decision | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!pendingDecision) return
    setSubmitting(true)
    setError(null)

    const res = await fetch(`/api/approvals/${approvalId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        decision: pendingDecision,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    })

    setSubmitting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not record the decision.')
      return
    }

    setPendingDecision(null)
    setNote('')
    router.refresh()
  }

  return (
    <>
      <div className="flex shrink-0 gap-2">
        <button
          onClick={() => setPendingDecision('approved')}
          className="rounded-lg bg-status-success px-3 py-1.5 text-xs font-medium text-white hover:bg-status-success"
        >
          Approve
        </button>
        <button
          onClick={() => setPendingDecision('rejected')}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted hover:bg-surface-bg"
        >
          Reject
        </button>
      </div>

      {pendingDecision && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-slate/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-brand-slate">
              {pendingDecision === 'approved' ? 'Approve' : 'Reject'} this request?
            </h3>
            <p className="mt-2 text-sm text-text-muted">{summary}</p>

            <label htmlFor="decision-note" className="mt-4 block text-xs font-medium text-text-muted">
              Note (optional)
            </label>
            <textarea
              id="decision-note"
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
            />

            {error && (
              <p className="mt-3 rounded-lg bg-status-danger/5 px-3 py-2 text-xs text-status-danger">{error}</p>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setPendingDecision(null)
                  setError(null)
                }}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted hover:bg-surface-bg"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 ${
                  pendingDecision === 'approved'
                    ? 'bg-status-success hover:bg-status-success'
                    : 'bg-status-danger hover:bg-status-danger'
                }`}
              >
                {submitting ? 'Saving…' : `Confirm ${pendingDecision === 'approved' ? 'approval' : 'rejection'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
