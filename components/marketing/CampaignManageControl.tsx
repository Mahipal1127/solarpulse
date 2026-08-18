'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAMPAIGN_STATUSES } from '@/lib/marketing/constants'
import { CAMPAIGN_STATUS_LABELS } from '@/lib/format'
import type { CampaignStatus } from '@/lib/types'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'
const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

/**
 * The two writes a manager makes on a live campaign: moving its status, and logging
 * the spend as it lands from the ad platform (no live sync — §"Do NOT build"). Both
 * PATCH /api/campaigns/[id]. leads_generated is never edited here — that counter is
 * owned by the lead handoff, and the update schema rejects it outright.
 */
export function CampaignManageControl({
  campaignId,
  status,
  amountSpent,
}: {
  campaignId: string
  status: CampaignStatus
  amountSpent: number
}) {
  const router = useRouter()
  const [spent, setSpent] = useState(String(amountSpent))
  const [pending, setPending] = useState<'status' | 'spend' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>, kind: 'status' | 'spend') {
    setPending(kind)
    setError(null)

    const res = await fetch(`/api/campaigns/${campaignId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setPending(null)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not update the campaign.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <span className={labelClass}>Status</span>
        <div className="flex flex-wrap gap-2">
          {CAMPAIGN_STATUSES.map((s) => (
            <button
              key={s}
              disabled={pending !== null || s === status}
              onClick={() => patch({ status: s }, 'status')}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                s === status
                  ? 'bg-brand-slate text-white'
                  : 'border border-border-subtle text-text-muted hover:border-brand-gold hover:text-brand-gold'
              }`}
            >
              {CAMPAIGN_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label htmlFor="spend" className={labelClass}>
          Amount spent (₹)
        </label>
        <div className="flex gap-2">
          <input
            id="spend"
            type="number"
            min="0"
            value={spent}
            onChange={(e) => setSpent(e.target.value)}
            className={inputClass}
          />
          <button
            disabled={pending !== null}
            onClick={() => patch({ amount_spent: Number(spent) || 0 }, 'spend')}
            className="shrink-0 rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
          >
            {pending === 'spend' ? 'Saving…' : 'Log spend'}
          </button>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Update as spend comes in from the ad platform.
        </p>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
