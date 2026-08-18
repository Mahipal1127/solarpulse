'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  amcVisitDisplayStatus,
  AMC_VISIT_STATUS_STYLES,
  AMC_VISIT_STATUS_LABELS,
} from '@/lib/format'
import { AMC_VISIT_TRANSITIONS } from '@/lib/om/constants'
import type { AmcVisit } from '@/lib/types'
import type { OMEmployee } from '@/lib/om/dashboard'

type VisitRow = AmcVisit & { performer?: { full_name: string } | null }

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * The visit schedule for one contract. v1 has no recurrence engine (§4) — visits are
 * added by hand. 'missed' is never stored: amcVisitDisplayStatus derives it from a
 * scheduled_date that has passed, so a visit nobody logged shows as missed the day
 * after without anything having to run.
 */
export function VisitsSection({
  contractId,
  visits,
  engineers,
  readOnly,
}: {
  contractId: string
  visits: VisitRow[]
  engineers: OMEmployee[]
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Maintenance visits</h2>
          <p className="mt-0.5 text-xs text-text-muted">{visits.length} scheduled</p>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Schedule visit
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <ScheduleForm
            contractId={contractId}
            engineers={engineers}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {visits.length === 0 && !adding ? (
        <EmptyState
          title="No visits scheduled"
          description={
            readOnly
              ? 'No maintenance visits have been scheduled on this contract.'
              : 'Schedule the next maintenance visit so it shows on the upcoming list.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {visits.map((v) => (
            <VisitRowItem key={v.id} visit={v} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </div>
  )
}

function VisitRowItem({ visit, readOnly }: { visit: VisitRow; readOnly: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rescheduling, setRescheduling] = useState(false)
  const [newDate, setNewDate] = useState(visit.scheduled_date)

  const display = amcVisitDisplayStatus(visit)
  const next = AMC_VISIT_TRANSITIONS[visit.status] ?? []

  async function patch(body: Record<string, unknown>) {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/amc-visits/${visit.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setPending(false)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not update the visit.')
      return false
    }

    router.refresh()
    return true
  }

  async function complete() {
    // Stamp today as the completed date; the service also stamps it, this keeps the
    // optimistic path honest.
    await patch({ status: 'completed' })
  }

  async function saveReschedule() {
    const ok = await patch({ status: 'rescheduled', scheduled_date: newDate })
    if (ok) setRescheduling(false)
  }

  return (
    <li className="px-5 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-brand-slate">
              {formatDate(visit.scheduled_date)}
            </span>
            <Badge className={AMC_VISIT_STATUS_STYLES[display]}>
              {AMC_VISIT_STATUS_LABELS[display]}
            </Badge>
          </div>
          {visit.completed_date && (
            <p className="mt-0.5 text-xs text-text-muted">
              Completed {formatDate(visit.completed_date)}
            </p>
          )}
          {visit.notes && (
            <p className="mt-1 text-xs leading-relaxed text-text-muted">{visit.notes}</p>
          )}
          {error && <p className="mt-1 text-xs text-status-danger">⚠ {error}</p>}
        </div>

        {!readOnly && next.length > 0 && !rescheduling && (
          <div className="flex shrink-0 items-center gap-2">
            {next.includes('completed') && (
              <button
                onClick={complete}
                disabled={pending}
                className="rounded-lg bg-status-success px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60"
              >
                Complete
              </button>
            )}
            {next.includes('rescheduled') && (
              <button
                onClick={() => setRescheduling(true)}
                disabled={pending}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
              >
                Reschedule
              </button>
            )}
          </div>
        )}
      </div>

      {rescheduling && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <label className={labelClass}>New date</label>
            <input
              type="date"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              className={inputClass}
            />
          </div>
          <button
            onClick={saveReschedule}
            disabled={pending}
            className="rounded-lg bg-brand-gold px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
          >
            Save
          </button>
          <button
            onClick={() => setRescheduling(false)}
            className="rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
          >
            Cancel
          </button>
        </div>
      )}
    </li>
  )
}

function ScheduleForm({
  contractId,
  engineers,
  onDone,
  onCancel,
}: {
  contractId: string
  engineers: OMEmployee[]
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [date, setDate] = useState('')
  const [performedBy, setPerformedBy] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!date) {
      setError('Pick a date for the visit.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/amc/${contractId}/visits`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scheduled_date: date,
        performed_by: performedBy || null,
        notes: notes.trim() || null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not schedule the visit.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="v-date" className={labelClass}>
            Scheduled date
          </label>
          <input
            id="v-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="v-eng" className={labelClass}>
            Engineer{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <select
            id="v-eng"
            value={performedBy}
            onChange={(e) => setPerformedBy(e.target.value)}
            className={inputClass}
          >
            <option value="">Unassigned</option>
            {engineers.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <label htmlFor="v-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="v-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
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
          {pending ? 'Scheduling…' : 'Schedule visit'}
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
