'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { TENDER_STATUS_LABELS } from '@/lib/format'
import type { TenderStatus } from '@/lib/types'

/**
 * Offers only forward-legal moves. This is a convenience, not a control — the
 * same transition table is enforced in lib/services/tenders.ts, which is what
 * actually decides whether the write lands.
 */
export function TenderStatusControl({
  tenderId,
  status,
  allowedTransitions,
  readOnly,
}: {
  tenderId: string
  status: TenderStatus
  allowedTransitions: TenderStatus[]
  readOnly: boolean
}) {
  const router = useRouter()
  const [next, setNext] = useState<TenderStatus | ''>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (readOnly) return null

  if (allowedTransitions.length === 0) {
    return (
      <p className="text-xs text-text-muted">
        {TENDER_STATUS_LABELS[status]} is a final state — no further transitions.
      </p>
    )
  }

  async function apply() {
    if (!next) return
    setPending(true)
    setError(null)

    const res = await fetch(`/api/tenders/${tenderId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not change the status.')
      return
    }

    setNext('')
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Change tender status"
          value={next}
          onChange={(e) => setNext(e.target.value as TenderStatus)}
          className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
        >
          <option value="">Move to…</option>
          {allowedTransitions.map((s) => (
            <option key={s} value={s}>
              {TENDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <button
          onClick={apply}
          disabled={!next || pending}
          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
        >
          {pending ? 'Updating…' : 'Apply'}
        </button>
      </div>
      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
