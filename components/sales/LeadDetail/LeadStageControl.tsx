'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LEAD_STATUS_LABELS, LEAD_OPEN_STAGES } from '@/lib/format'
import type { LeadStatus } from '@/lib/types'

/**
 * Manual stage moves for the transitions no record implies. "Contacted" is the
 * clear case: a phone call that produced nothing to file still moved the lead.
 *
 * 'won' and 'lost' are absent by design. Won is only reachable through Close
 * Deal, which writes the customer and closure rows atomically — the update schema
 * rejects it here — and lost has its own confirm dialog so the reason gets
 * captured.
 */
export function LeadStageControl({
  leadId,
  status,
}: {
  leadId: string
  status: LeadStatus
}) {
  const router = useRouter()
  const [next, setNext] = useState<LeadStatus | ''>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = LEAD_OPEN_STAGES.filter((s) => s !== status)

  async function apply() {
    if (!next) return
    setPending(true)
    setError(null)

    const res = await fetch(`/api/leads/${leadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not change the stage.')
      return
    }

    setNext('')
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Change pipeline stage"
          value={next}
          onChange={(e) => setNext(e.target.value as LeadStatus)}
          className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
        >
          <option value="">Move to…</option>
          {options.map((s) => (
            <option key={s} value={s}>
              {LEAD_STATUS_LABELS[s]}
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
