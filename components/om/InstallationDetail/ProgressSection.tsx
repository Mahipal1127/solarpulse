'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState, ProgressBar } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'

type ProgressRow = {
  id: string
  progress_percent: number
  note: string | null
  created_at: string
  author: { full_name: string } | null
}

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * The daily progress log. Append-only: each update is a fresh row (no edit/delete),
 * so the timeline is the site's honest history. The newest update's percentage is
 * "where the job is" — shown up top — and the rest read as a diary below.
 */
export function ProgressSection({
  installationId,
  updates,
  readOnly,
}: {
  installationId: string
  updates: ProgressRow[]
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)

  // Updates arrive newest-first from the query; the first is the current standing.
  const latest = updates[0]?.progress_percent ?? 0

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-brand-slate">Progress</h2>
          <div className="mt-2 max-w-md">
            <ProgressBar value={latest} />
            <p className="mt-1 text-xs text-text-muted">{latest}% complete</p>
          </div>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="ml-4 shrink-0 rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Log update
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <ProgressForm
            installationId={installationId}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {updates.length === 0 && !adding ? (
        <EmptyState
          title="No progress logged yet"
          description={
            readOnly
              ? 'The crew has not logged any progress on this installation.'
              : 'Log the first update so the team and the office can see where the job stands.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {updates.map((u) => (
            <li key={u.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold text-brand-slate">{u.progress_percent}%</span>
                <span className="text-xs text-text-muted">
                  {u.author?.full_name ?? 'Unknown'} · {formatDateTime(u.created_at)}
                </span>
              </div>
              {u.note && (
                <p className="mt-1 text-xs leading-relaxed text-text-muted">{u.note}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ProgressForm({
  installationId,
  onDone,
  onCancel,
}: {
  installationId: string
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [percent, setPercent] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const value = Number(percent)
    if (percent === '' || Number.isNaN(value) || value < 0 || value > 100) {
      setError('Enter a percentage between 0 and 100.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/installations/${installationId}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ progress_percent: Math.round(value), note: note.trim() || null }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not log the update.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div>
        <label htmlFor="pr-percent" className={labelClass}>
          Percent complete
        </label>
        <input
          id="pr-percent"
          type="number"
          min={0}
          max={100}
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="pr-note" className={labelClass}>
          Note
        </label>
        <textarea
          id="pr-note"
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What got done today, what is blocking."
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
          {pending ? 'Saving…' : 'Log update'}
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
