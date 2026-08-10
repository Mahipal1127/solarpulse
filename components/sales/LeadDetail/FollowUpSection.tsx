'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDateTime,
  isFollowUpOverdue,
  FOLLOW_UP_STATUS_STYLES,
  FOLLOW_UP_STATUS_LABELS,
  FOLLOW_UP_TYPE_LABELS,
} from '@/lib/format'
import type { FollowUp, FollowUpType } from '@/lib/types'

const TYPES: FollowUpType[] = ['call', 'meeting', 'email', 'site_visit_reminder']

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function FollowUpSection({
  leadId,
  followUps,
  readOnly,
  leadClosed,
}: {
  leadId: string
  followUps: FollowUp[]
  readOnly: boolean
  leadClosed: boolean
}) {
  const [adding, setAdding] = useState(false)

  const pending = followUps.filter((f) => f.status === 'pending')
  const overdueCount = pending.filter(isFollowUpOverdue).length
  const canAdd = !readOnly && !leadClosed

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Follow-ups</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {pending.length} pending
            {overdueCount > 0 && (
              <span className="font-medium text-status-danger"> · {overdueCount} overdue</span>
            )}
          </p>
        </div>
        {canAdd && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Schedule follow-up
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <ScheduleForm
            leadId={leadId}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {followUps.length === 0 && !adding ? (
        <EmptyState
          title="No follow-ups scheduled"
          description={
            readOnly
              ? 'No follow-up has been scheduled against this lead.'
              : leadClosed
                ? 'This lead is closed, so no further follow-ups can be scheduled.'
                : 'Schedule a call or meeting so this lead does not go quiet.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {followUps.map((followUp) => (
            <FollowUpRow key={followUp.id} followUp={followUp} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </div>
  )
}

function FollowUpRow({ followUp, readOnly }: { followUp: FollowUp; readOnly: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Overdue is computed from scheduled_for every render, never read from status.
  // Nothing has to run on a schedule for a missed call to look missed.
  const overdue = isFollowUpOverdue(followUp)

  async function resolve(status: 'completed' | 'missed') {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/follow-ups/${followUp.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the follow-up.')
      return
    }

    router.refresh()
  }

  return (
    <li
      className={`border-l-4 px-5 py-4 pl-4 ${
        overdue ? 'border-l-rose-500' : 'border-l-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-slate">
              {FOLLOW_UP_TYPE_LABELS[followUp.type]}
            </span>
            <Badge className={FOLLOW_UP_STATUS_STYLES[followUp.status]}>
              {FOLLOW_UP_STATUS_LABELS[followUp.status]}
            </Badge>
            {overdue && <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>}
          </div>

          <p className="text-xs text-text-muted">
            {formatDateTime(followUp.scheduled_for)}
            {followUp.completed_at && ` · Completed ${formatDateTime(followUp.completed_at)}`}
          </p>

          {followUp.notes && (
            <p className="text-xs leading-relaxed text-text-muted">{followUp.notes}</p>
          )}
          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
        </div>

        {!readOnly && followUp.status === 'pending' && (
          <div className="flex shrink-0 items-center gap-2">
            <button
              onClick={() => resolve('completed')}
              disabled={pending}
              className="rounded-lg bg-status-success px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-status-success disabled:opacity-60"
            >
              Done
            </button>
            <button
              onClick={() => resolve('missed')}
              disabled={pending}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
            >
              Missed
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

function ScheduleForm({
  leadId,
  onDone,
  onCancel,
}: {
  leadId: string
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [scheduledFor, setScheduledFor] = useState('')
  const [type, setType] = useState<FollowUpType>('call')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!scheduledFor) {
      setError('Pick a date and time for the follow-up.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/leads/${leadId}/follow-ups`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // The API expects an ISO instant; the input gives local wall time.
        scheduled_for: new Date(scheduledFor).toISOString(),
        type,
        notes: notes.trim() || null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not schedule the follow-up.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="fu-when" className={labelClass}>
            When
          </label>
          <input
            id="fu-when"
            type="datetime-local"
            value={scheduledFor}
            onChange={(e) => setScheduledFor(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="fu-type" className={labelClass}>
            Type
          </label>
          <select
            id="fu-type"
            value={type}
            onChange={(e) => setType(e.target.value as FollowUpType)}
            className={inputClass}
          >
            {TYPES.map((t) => (
              <option key={t} value={t}>
                {FOLLOW_UP_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="fu-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="fu-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What to cover on this call."
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
          {pending ? 'Saving…' : 'Schedule'}
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
