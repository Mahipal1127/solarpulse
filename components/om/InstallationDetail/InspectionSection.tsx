'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDateTime,
  INSPECTION_RESULT_STYLES,
  INSPECTION_RESULT_LABELS,
} from '@/lib/format'
import { inspectionResult } from '@/lib/validation/schemas'
import type { InspectionResult } from '@/lib/types'

type InspectionRow = {
  id: string
  result: string
  notes: string | null
  inspected_at: string
  inspector: { full_name: string } | null
}

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

const RESULTS = inspectionResult.options as InspectionResult[]

/**
 * Final inspections. §3.3 says the inspection informs completion but does not gate
 * it — there is no separate-inspector requirement and a failed inspection does not
 * block anything in software, it just gets recorded so the history shows it. A site
 * can be inspected more than once (fix, re-inspect), so this is a log, not a single
 * field.
 */
export function InspectionSection({
  installationId,
  inspections,
  readOnly,
}: {
  installationId: string
  inspections: InspectionRow[]
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Final inspection</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {inspections.length === 0
              ? 'Not yet inspected'
              : `${inspections.length} on record`}
          </p>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Record inspection
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <InspectionForm
            installationId={installationId}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {inspections.length === 0 && !adding ? (
        <EmptyState
          title="No inspection recorded"
          description={
            readOnly
              ? 'No final inspection has been logged for this installation.'
              : 'Record the inspection result once the site has been checked over.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {inspections.map((ins) => (
            <li key={ins.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <Badge className={INSPECTION_RESULT_STYLES[ins.result as InspectionResult]}>
                  {INSPECTION_RESULT_LABELS[ins.result as InspectionResult]}
                </Badge>
                <span className="text-xs text-text-muted">
                  {ins.inspector?.full_name ?? 'Unknown'} · {formatDateTime(ins.inspected_at)}
                </span>
              </div>
              {ins.notes && (
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{ins.notes}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function InspectionForm({
  installationId,
  onDone,
  onCancel,
}: {
  installationId: string
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [result, setResult] = useState<InspectionResult>('passed')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/installations/${installationId}/inspection`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ result, notes: notes.trim() || null }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not record the inspection.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="ins-result" className={labelClass}>
          Result
        </label>
        <select
          id="ins-result"
          value={result}
          onChange={(e) => setResult(e.target.value as InspectionResult)}
          className={inputClass}
        >
          {RESULTS.map((r) => (
            <option key={r} value={r}>
              {INSPECTION_RESULT_LABELS[r]}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="ins-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="ins-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What was checked, anything to follow up."
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
          {pending ? 'Saving…' : 'Record inspection'}
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
