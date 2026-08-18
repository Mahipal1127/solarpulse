'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Records a status change on a net-metering application or subsidy case.
 *
 * Unlike O&M's StatusControl, there is no transition table: DISCOM status mirrors an
 * external process the liaison only observes (a board can send a case back for more
 * papers, or reject one outright), so every status except the current one is offered.
 * The POST goes to the dedicated /status endpoint, which appends a history row — the
 * only path that moves status, and what keeps the aging clock honest. An optional
 * note explains the move ("board asked for revised load sanction") and lands on the
 * timeline.
 *
 * `endpoint` is the base resource path; this posts to `${endpoint}/status`.
 */
export function CaseStatusControl<Status extends string>({
  endpoint,
  current,
  statuses,
  labels,
}: {
  endpoint: string
  current: Status
  statuses: readonly Status[]
  labels: Record<Status, string>
}) {
  const router = useRouter()
  const [target, setTarget] = useState<Status | ''>('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = statuses.filter((s) => s !== current)

  async function save() {
    if (!target) {
      setError('Pick the status to move to.')
      return
    }
    setPending(true)
    setError(null)

    const res = await fetch(`${endpoint}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: target, note: note.trim() || null }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the status.')
      return
    }

    setTarget('')
    setNote('')
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="status-target" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Move to
          </label>
          <select
            id="status-target"
            value={target}
            onChange={(e) => setTarget(e.target.value as Status)}
            className="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
          >
            <option value="">Select status…</option>
            {options.map((s) => (
              <option key={s} value={s}>
                {labels[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="status-note" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Note (optional)
          </label>
          <input
            id="status-note"
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. board raised a load-sanction query"
            className="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
          />
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Recording…' : 'Record status change'}
      </button>
    </div>
  )
}
