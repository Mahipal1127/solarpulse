'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CAMPAIGN_OBJECTIVES, CAMPAIGN_PLATFORMS } from '@/lib/marketing/constants'
import { CAMPAIGN_OBJECTIVE_LABELS, CAMPAIGN_PLATFORM_LABELS } from '@/lib/format'
import type { MarketingEmployee } from '@/lib/marketing/dashboard'
import type { CampaignObjective, CampaignPlatform } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Creates a campaign. amount_spent and leads_generated are not set here — spend is
 * logged periodically on the detail page, and the lead counter is owned by the
 * handoff. The manager must be a Marketing person (the service checks).
 */
export function CampaignForm({ employees }: { employees: MarketingEmployee[] }) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [objective, setObjective] = useState<CampaignObjective | ''>('')
  const [platform, setPlatform] = useState<CampaignPlatform | ''>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [budget, setBudget] = useState('')
  const [managedBy, setManagedBy] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!name.trim()) return setError('Name the campaign.')
    if (!managedBy) return setError('Assign a campaign manager.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        objective: objective || null,
        platform: platform || null,
        start_date: startDate || null,
        end_date: endDate || null,
        budget_amount: budget ? Number(budget) : null,
        managed_by: managedBy,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the campaign.')
      return
    }

    router.push(`/marketing/campaigns/${body.campaign.id}`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="c-name" className={labelClass}>
          Campaign name
        </label>
        <input
          id="c-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Diwali rooftop push"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="c-objective" className={labelClass}>
            Objective
          </label>
          <select
            id="c-objective"
            value={objective}
            onChange={(e) => setObjective(e.target.value as CampaignObjective | '')}
            className={inputClass}
          >
            <option value="">—</option>
            {CAMPAIGN_OBJECTIVES.map((o) => (
              <option key={o} value={o}>
                {CAMPAIGN_OBJECTIVE_LABELS[o]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="c-platform" className={labelClass}>
            Platform
          </label>
          <select
            id="c-platform"
            value={platform}
            onChange={(e) => setPlatform(e.target.value as CampaignPlatform | '')}
            className={inputClass}
          >
            <option value="">—</option>
            {CAMPAIGN_PLATFORMS.map((p) => (
              <option key={p} value={p}>
                {CAMPAIGN_PLATFORM_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="c-start" className={labelClass}>
            Start date
          </label>
          <input
            id="c-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="c-end" className={labelClass}>
            End date
          </label>
          <input
            id="c-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="c-budget" className={labelClass}>
            Budget (₹)
          </label>
          <input
            id="c-budget"
            type="number"
            min="0"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="c-manager" className={labelClass}>
          Managed by
        </label>
        <select
          id="c-manager"
          value={managedBy}
          onChange={(e) => setManagedBy(e.target.value)}
          className={inputClass}
        >
          <option value="">Select…</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create campaign'}
      </button>
    </div>
  )
}
