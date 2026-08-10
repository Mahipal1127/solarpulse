'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  formatDateTime,
  SITE_VISIT_STATUS_STYLES,
  SITE_VISIT_STATUS_LABELS,
} from '@/lib/format'
import type { SiteVisitRequest, SiteVisitStatus } from '@/lib/types'

const STATUSES: SiteVisitStatus[] = ['requested', 'scheduled', 'completed', 'cancelled']

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Sales' side of the handoff to Technical. This records that a visit was asked
 * for and what came of it — the scheduling and the survey itself belong to the
 * Technical module, which does not exist yet, so status is set by hand here.
 */
export function SiteVisitSection({
  leadId,
  requests,
  readOnly,
  leadClosed,
}: {
  leadId: string
  requests: SiteVisitRequest[]
  readOnly: boolean
  leadClosed: boolean
}) {
  const [requesting, setRequesting] = useState(false)
  const canRequest = !readOnly && !leadClosed

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Site Visits</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Handoff to Technical. Requesting one moves the lead to Site Visit Scheduled.
          </p>
        </div>
        {canRequest && !requesting && (
          <button
            onClick={() => setRequesting(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Request visit
          </button>
        )}
      </div>

      {requesting && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <RequestForm
            leadId={leadId}
            onDone={() => setRequesting(false)}
            onCancel={() => setRequesting(false)}
          />
        </div>
      )}

      {requests.length === 0 && !requesting ? (
        <EmptyState
          title="No site visit requested"
          description={
            readOnly
              ? 'No site visit has been requested for this lead.'
              : leadClosed
                ? 'This lead is closed, so no further visits can be requested.'
                : 'Request a visit once the customer is qualified enough to survey.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {requests.map((request) => (
            <RequestRow key={request.id} request={request} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </div>
  )
}

function RequestRow({
  request,
  readOnly,
}: {
  request: SiteVisitRequest
  readOnly: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const open = request.status === 'requested' || request.status === 'scheduled'

  async function setStatus(status: SiteVisitStatus) {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/site-visits/${request.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the site visit.')
      return
    }

    router.refresh()
  }

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={SITE_VISIT_STATUS_STYLES[request.status]}>
              {SITE_VISIT_STATUS_LABELS[request.status]}
            </Badge>
            <span className="text-xs text-text-muted">
              {request.preferred_date
                ? `Preferred ${formatDate(request.preferred_date)}`
                : 'No preferred date'}
            </span>
          </div>

          <p className="text-xs text-text-muted">
            Requested {formatDateTime(request.created_at)}
          </p>

          {request.notes && (
            <p className="text-xs leading-relaxed text-text-muted">{request.notes}</p>
          )}
          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
        </div>

        {!readOnly && open && (
          <div className="flex shrink-0 items-center gap-2">
            <select
              aria-label="Update site visit status"
              value={request.status}
              disabled={pending}
              onChange={(e) => setStatus(e.target.value as SiteVisitStatus)}
              className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs outline-none focus:border-brand-gold disabled:opacity-60"
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {SITE_VISIT_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
    </li>
  )
}

function RequestForm({
  leadId,
  onDone,
  onCancel,
}: {
  leadId: string
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [preferredDate, setPreferredDate] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/leads/${leadId}/site-visit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The API takes an ISO instant. A bare date input has no time, so noon
        // local is used rather than midnight — a visit "on the 12th" should not
        // land on the 11th in a negative-offset zone.
        preferred_date: preferredDate ? new Date(`${preferredDate}T12:00`).toISOString() : null,
        notes: notes.trim() || null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not request the site visit.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="sv-date" className={labelClass}>
            Preferred Date
          </label>
          <input
            id="sv-date"
            type="date"
            value={preferredDate}
            onChange={(e) => setPreferredDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="sv-notes" className={labelClass}>
          Notes for the survey team
        </label>
        <textarea
          id="sv-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Roof type, access constraints, who to call on arrival."
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
          {pending ? 'Saving…' : 'Request visit'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
