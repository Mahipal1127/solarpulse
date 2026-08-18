'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'
import type { InstallationStatus } from '@/lib/types'

type CompletionRow = { id: string; summary: string; created_at: string }

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * The completion report. Submitting it does NOT flip the installation to completed —
 * §3.2/§3.3 want the report and the status change to stay separate decisions, so
 * after saving we nudge the user toward the status control rather than moving the
 * record for them. That nudge only shows while the install is still open.
 */
export function CompletionSection({
  installationId,
  reports,
  status,
  readOnly,
}: {
  installationId: string
  reports: CompletionRow[]
  status: InstallationStatus
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)

  const stillOpen = status !== 'completed' && status !== 'cancelled'

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Completion report</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {reports.length === 0 ? 'Not yet submitted' : `${reports.length} submitted`}
          </p>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Submit report
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <CompletionForm
            installationId={installationId}
            showCompleteNudge={stillOpen}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {reports.length === 0 && !adding ? (
        <EmptyState
          title="No completion report yet"
          description={
            readOnly
              ? 'No completion report has been submitted for this installation.'
              : 'Summarise the finished work. Submitting a report does not close the job — mark it completed from the status panel when you are ready.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {reports.map((r) => (
            <li key={r.id} className="px-5 py-3.5">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-brand-slate">
                {r.summary}
              </p>
              <p className="mt-1 text-xs text-text-muted">{formatDateTime(r.created_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function CompletionForm({
  installationId,
  showCompleteNudge,
  onDone,
  onCancel,
}: {
  installationId: string
  showCompleteNudge: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [summary, setSummary] = useState('')
  const [actualSize, setActualSize] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (summary.trim().length < 10) {
      setError('Summarise the completed work (at least a sentence).')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/installations/${installationId}/completion-report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: summary.trim(),
        actual_system_size_kw: actualSize ? Number(actualSize) : null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not submit the report.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      {showCompleteNudge && (
        <p className="rounded-lg bg-status-info/5 px-3 py-2 text-xs text-status-info">
          Submitting this report records it but keeps the installation open. Mark it Completed from
          the status panel when the job is truly done.
        </p>
      )}
      <div>
        <label htmlFor="cr-summary" className={labelClass}>
          Summary
        </label>
        <textarea
          id="cr-summary"
          rows={4}
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="What was installed, how it performed on commissioning, anything handed to the customer."
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="cr-size" className={labelClass}>
          Actual system size{' '}
          <span className="font-normal normal-case text-text-muted/60">(kW, optional)</span>
        </label>
        <input
          id="cr-size"
          type="number"
          min={0}
          step="0.1"
          value={actualSize}
          onChange={(e) => setActualSize(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {pending ? 'Submitting…' : 'Submit report'}
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
