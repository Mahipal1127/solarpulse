'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, ArrowRight } from 'lucide-react'
import {
  LEAD_SOURCE_DETAILS,
  LEAD_SOURCE_DETAIL_LABELS,
} from '@/lib/marketing/constants'
import type { CampaignOption, ContentItemOption } from '@/lib/marketing/queries'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * The Marketing → Sales handoff form — the reason this module ships ahead of Sales.
 * It POSTs to /api/leads/from-campaign, which runs the create_marketing_lead RPC: in
 * one transaction it inserts an unassigned inbound lead into Sales' table, writes the
 * lead_sources trace row, and bumps the campaign counter. Marketing never reads the
 * Sales pipeline back — on success we only learn the new lead's id, and we surface
 * that as a confirmation, not a link into Sales.
 *
 * Only the name is required. campaign_id and content_calendar_item_id are the two
 * optional origins; either may arrive pre-selected from a deep link (a campaign's
 * "Log new lead", or a post's "Log lead from this").
 */
export function LeadFromCampaignForm({
  campaigns,
  contentItems,
  initialCampaignId,
  initialContentItemId,
}: {
  campaigns: CampaignOption[]
  contentItems: ContentItemOption[]
  initialCampaignId?: string
  initialContentItemId?: string
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [sourceDetail, setSourceDetail] = useState('')
  const [campaignId, setCampaignId] = useState(initialCampaignId ?? '')
  const [contentItemId, setContentItemId] = useState(initialContentItemId ?? '')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [doneLeadId, setDoneLeadId] = useState<string | null>(null)

  async function submit() {
    if (!name.trim()) {
      setError('The lead needs a name.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch('/api/leads/from-campaign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim() || null,
        source_detail: sourceDetail || null,
        campaign_id: campaignId || null,
        content_calendar_item_id: contentItemId || null,
        notes: notes.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not log the lead.')
      return
    }

    setDoneLeadId(body.leadId ?? 'sent')
    // Refresh so a campaign detail navigated back to shows the bumped counter.
    router.refresh()
  }

  function reset() {
    setName('')
    setPhone('')
    setSourceDetail('')
    setNotes('')
    // Keep the origin selections — a run of leads off the same campaign is common.
    setDoneLeadId(null)
    setError(null)
  }

  if (doneLeadId) {
    return (
      <div className="rounded-2xl border border-status-success/30 bg-status-success/5 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-status-success" />
        <h2 className="mt-3 text-lg font-semibold text-brand-slate">Lead handed to Sales</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-text-muted">
          The lead was created in the Sales pipeline as an unassigned inbound lead, and this
          campaign&rsquo;s lead count went up by one. A Sales manager will pick it up from there —
          Marketing can&rsquo;t see or steer the pipeline beyond this point.
        </p>
        <div className="mt-5 flex flex-wrap justify-center gap-3">
          <button
            onClick={reset}
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            Log another lead
          </button>
          <button
            onClick={() => router.push('/marketing/campaigns')}
            className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
          >
            Back to campaigns
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="l-name" className={labelClass}>
          Lead name
        </label>
        <input
          id="l-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Who got in touch?"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="l-phone" className={labelClass}>
            Phone
          </label>
          <input
            id="l-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="Optional"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="l-source" className={labelClass}>
            How it came in
          </label>
          <select
            id="l-source"
            value={sourceDetail}
            onChange={(e) => setSourceDetail(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {LEAD_SOURCE_DETAILS.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_DETAIL_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="l-campaign" className={labelClass}>
            From campaign
          </label>
          <select
            id="l-campaign"
            value={campaignId}
            onChange={(e) => setCampaignId(e.target.value)}
            className={inputClass}
          >
            <option value="">— None —</option>
            {campaigns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="l-content" className={labelClass}>
            From content
          </label>
          <select
            id="l-content"
            value={contentItemId}
            onChange={(e) => setContentItemId(e.target.value)}
            className={inputClass}
          >
            <option value="">— None —</option>
            {contentItems.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="l-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="l-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything Sales should know about this lead"
          className={inputClass}
        />
      </div>

      <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
        This creates a lead in the Sales pipeline. It goes in unassigned for a Sales manager to
        claim — Marketing can&rsquo;t read or reassign it afterward.
      </p>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={submit}
        disabled={pending}
        className="inline-flex items-center gap-2 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Sending to Sales…' : 'Hand to Sales'}
        {!pending && <ArrowRight className="h-4 w-4" />}
      </button>
    </div>
  )
}
