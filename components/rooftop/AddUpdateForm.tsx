'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ROOFTOP_UPDATE_KIND_LABELS } from '@/lib/format'
import type { RooftopUpdateKind } from '@/lib/types'

/**
 * Logging what happened on a site. Any department member can log against any
 * site they can see — monitoring is collective, per 0026's policy shape.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

const KINDS: RooftopUpdateKind[] = ['progress', 'issue', 'resolved', 'handover']

export function AddUpdateForm({ projectId }: { projectId: string }) {
  const router = useRouter()
  const [kind, setKind] = useState<RooftopUpdateKind>('progress')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    if (!note.trim()) {
      setServerError('Describe what happened on site.')
      return
    }

    setSubmitting(true)
    const res = await fetch(`/api/rooftop/${projectId}/updates`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind, note }),
    })
    const body = await res.json().catch(() => ({}))
    setSubmitting(false)

    if (!res.ok) {
      setServerError(body.error ?? 'Could not log the update.')
      return
    }

    setNote('')
    setKind('progress')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[180px_1fr]">
        <div>
          <label htmlFor={`kind-${projectId}`} className={labelClass}>
            Kind
          </label>
          <select
            id={`kind-${projectId}`}
            value={kind}
            onChange={(e) => setKind(e.target.value as RooftopUpdateKind)}
            className={inputClass}
          >
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {ROOFTOP_UPDATE_KIND_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`note-${projectId}`} className={labelClass}>
            What happened on site
          </label>
          <textarea
            id={`note-${projectId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="Panel mounting started; two installers on site today."
            className={inputClass}
          />
        </div>
      </div>

      {serverError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{serverError}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {submitting ? 'Logging…' : 'Log update'}
      </button>
    </form>
  )
}
