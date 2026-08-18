'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'

type ReportRow = {
  id: string
  work_done: string
  parts_used: string | null
  resolved: boolean
  created_at: string
  author: { full_name: string } | null
}

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Service reports — the visit write-ups. This is the gate on resolution: a ticket
 * cannot reach 'resolved' with none on file (enforced in the service layer). Ticking
 * "this resolved the complaint" both records that and advances the ticket to
 * resolved in the same call, so the common case is one action, not two.
 */
export function ServiceReportSection({
  ticketId,
  reports,
  canResolve,
  readOnly,
}: {
  ticketId: string
  reports: ReportRow[]
  /** False once the ticket is already resolved/closed — then reports are history. */
  canResolve: boolean
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Service reports</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {reports.length === 0 ? 'None logged' : `${reports.length} on file`}
          </p>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Log report
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <ReportForm
            ticketId={ticketId}
            canResolve={canResolve}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {reports.length === 0 && !adding ? (
        <EmptyState
          title="No service reports yet"
          description={
            readOnly
              ? 'No service report has been logged against this ticket.'
              : 'Log what was done on the visit. A report is required before the ticket can be resolved.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {reports.map((r) => (
            <li key={r.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-medium text-text-muted">
                  {r.author?.full_name ?? 'Unknown'} · {formatDateTime(r.created_at)}
                </p>
                {r.resolved && (
                  <span className="rounded-full bg-status-success/10 px-2 py-0.5 text-xs font-medium text-status-success">
                    Marked resolved
                  </span>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-brand-slate">
                {r.work_done}
              </p>
              {r.parts_used && (
                <p className="mt-1 text-xs text-text-muted">Parts: {r.parts_used}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReportForm({
  ticketId,
  canResolve,
  onDone,
  onCancel,
}: {
  ticketId: string
  canResolve: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [workDone, setWorkDone] = useState('')
  const [partsUsed, setPartsUsed] = useState('')
  const [resolved, setResolved] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (workDone.trim().length < 5) {
      setError('Describe the work done.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/service-tickets/${ticketId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        work_done: workDone.trim(),
        parts_used: partsUsed.trim() || null,
        resolved: canResolve && resolved,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not log the report.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="sr-work" className={labelClass}>
          Work done
        </label>
        <textarea
          id="sr-work"
          rows={3}
          value={workDone}
          onChange={(e) => setWorkDone(e.target.value)}
          placeholder="What was diagnosed and fixed on the visit."
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="sr-parts" className={labelClass}>
          Parts used{' '}
          <span className="font-normal normal-case text-text-muted/60">(optional)</span>
        </label>
        <input
          id="sr-parts"
          value={partsUsed}
          onChange={(e) => setPartsUsed(e.target.value)}
          placeholder="Replacement inverter fan, 2× MC4 connectors…"
          className={inputClass}
        />
      </div>

      {canResolve && (
        <label className="flex items-center gap-2 text-sm text-brand-slate">
          <input
            type="checkbox"
            checked={resolved}
            onChange={(e) => setResolved(e.target.checked)}
            className="h-4 w-4 rounded border-border-subtle text-brand-gold focus:ring-brand-gold"
          />
          This resolved the complaint — mark the ticket resolved
        </label>
      )}

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Log report'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-white"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
