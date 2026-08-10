'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { formatDateTime, isFollowUpOverdue, FOLLOW_UP_TYPE_LABELS } from '@/lib/format'
import type { FollowUp } from '@/lib/types'

export type QueuedFollowUp = FollowUp & {
  // assigned_to comes along so a manager's dashboard can split "mine" from "the
  // team's" without a second query. RLS still decides which rows exist at all.
  lead: { id: string; name: string; assigned_to: string | null } | null
}

/**
 * The dashboard's "what do I have to do today" list: pending follow-ups that are
 * due today or already past due, resolvable in place.
 *
 * Overdue is computed from scheduled_for on every render, never read from a
 * status column — nothing has to run on a schedule for a missed call to look
 * missed, which is what the acceptance criteria require.
 */
export function FollowUpQueue({
  followUps,
  readOnly,
}: {
  followUps: QueuedFollowUp[]
  readOnly: boolean
}) {
  if (followUps.length === 0) {
    return (
      <EmptyState
        title="Nothing due today"
        description="Follow-ups scheduled for today, and anything already past due, land here."
      />
    )
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {followUps.map((followUp) => (
        <QueueRow key={followUp.id} followUp={followUp} readOnly={readOnly} />
      ))}
    </ul>
  )
}

function QueueRow({
  followUp,
  readOnly,
}: {
  followUp: QueuedFollowUp
  readOnly: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
      className={`border-l-4 py-3 pl-4 pr-5 ${
        overdue ? 'border-l-rose-500' : 'border-l-transparent'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            {followUp.lead ? (
              <Link
                href={`/sales/leads/${followUp.lead.id}`}
                className="truncate text-sm font-semibold text-brand-slate hover:text-brand-slate"
              >
                {followUp.lead.name}
              </Link>
            ) : (
              <span className="text-sm font-semibold text-text-muted">Lead unavailable</span>
            )}
            {overdue && <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>}
          </div>

          <p className="text-xs text-text-muted">
            {FOLLOW_UP_TYPE_LABELS[followUp.type]} · {formatDateTime(followUp.scheduled_for)}
          </p>

          {followUp.notes && <p className="truncate text-xs text-text-muted">{followUp.notes}</p>}
          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => resolve('completed')}
              disabled={pending}
              className="rounded-lg bg-status-success px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-status-success disabled:opacity-60"
            >
              Done
            </button>
            <button
              onClick={() => resolve('missed')}
              disabled={pending}
              className="rounded-lg border border-border-subtle px-2.5 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
            >
              Missed
            </button>
          </div>
        )}
      </div>
    </li>
  )
}
