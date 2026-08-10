'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDateTime,
  IT_TICKET_STATUS_STYLES,
  IT_TICKET_STATUS_LABELS,
  IT_ISSUE_TYPE_LABELS,
} from '@/lib/format'
import { IT_TICKET_TRANSITIONS } from '@/lib/technical/constants'
import { pillClass } from '@/components/shared/chrome'
import type { ITSupportTicket, ITTicketStatus } from '@/lib/types'

export type TicketRow = ITSupportTicket & {
  raiser: { full_name: string; departments: { name: string } | null } | null
  assignee: { full_name: string } | null
}

export interface TicketAssigneeOption {
  id: string
  full_name: string
}

const STATUS_FILTERS: (ITTicketStatus | 'all')[] = [
  'all',
  'open',
  'in_progress',
  'resolved',
  'closed',
]

/**
 * The IT support queue.
 *
 * Two audiences on one component, because the difference is a matter of what RLS
 * returned rather than a separate page: a Technical member gets the whole queue with
 * triage controls, and everyone else gets the tickets they raised, read-only. That
 * asymmetry is the module's deliberate exception — anyone in the company reports a
 * broken login, only Technical decides what happens to it.
 */
export function TicketQueue({
  tickets,
  assignees,
  currentUserId,
  /** Technical member: may triage. False for a reporter following their own ticket. */
  canTriage,
}: {
  tickets: TicketRow[]
  assignees: TicketAssigneeOption[]
  currentUserId: string
  canTriage: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<ITTicketStatus | 'all'>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const visible = useMemo(() => {
    return tickets.filter((ticket) => {
      if (status !== 'all' && ticket.status !== status) return false
      if (mineOnly && ticket.assigned_to !== currentUserId) return false
      return true
    })
  }, [tickets, status, mineOnly, currentUserId])

  async function patch(ticketId: string, body: Record<string, unknown>, label: string) {
    setBusy(ticketId + label)
    setError(null)

    const res = await fetch(`/api/it-support/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    const payload = await res.json().catch(() => ({}))
    setBusy(null)

    if (!res.ok) {
      setError(payload.error ?? 'Could not update the ticket.')
      return
    }

    router.refresh()
  }

  return (
    <Card>
      <CardHeader
        title={canTriage ? 'Support queue' : 'Your tickets'}
        subtitle={
          canTriage
            ? `${visible.length} of ${tickets.length} shown — reported from across the company`
            : 'Problems you reported, and where they stand'
        }
      />

      {canTriage && (
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface-bg px-5 py-3">
          <div className="flex flex-wrap gap-1.5">
            {STATUS_FILTERS.map((option) => (
              <button
                key={option}
                onClick={() => setStatus(option)}
                className={pillClass(status === option)}
              >
                {option === 'all' ? 'All' : IT_TICKET_STATUS_LABELS[option]}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-subtle text-brand-slate "
            />
            Assigned to me
          </label>
        </div>
      )}

      {error && (
        <p className="border-b border-status-danger/15 bg-status-danger/5 px-5 py-2.5 text-xs text-status-danger">
          ⚠ {error}
        </p>
      )}

      {visible.length === 0 ? (
        <EmptyState
          title={canTriage ? 'Nothing in the queue' : 'You have not reported anything'}
          description={
            canTriage
              ? 'ERP bugs, lost logins and broken laptops land here from every department.'
              : 'Use the Report button in the header to report a problem with the company’s tools.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {visible.map((ticket) => {
            const moves = IT_TICKET_TRANSITIONS[ticket.status] ?? []

            return (
              <li key={ticket.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={IT_TICKET_STATUS_STYLES[ticket.status]}>
                        {IT_TICKET_STATUS_LABELS[ticket.status]}
                      </Badge>
                      <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                        {ticket.issue_type
                          ? IT_ISSUE_TYPE_LABELS[ticket.issue_type]
                          : 'Unclassified'}
                      </Badge>
                      {ticket.assigned_to === null && ticket.status === 'open' && (
                        <Badge className="bg-status-warning/10 text-status-warning ring-status-warning/25">
                          Unassigned
                        </Badge>
                      )}
                    </div>

                    <p className="mt-2 whitespace-pre-wrap text-sm text-brand-slate">
                      {ticket.description}
                    </p>

                    <p className="mt-1.5 text-xs text-text-muted">
                      {ticket.raiser?.full_name ?? 'Unknown'}
                      {ticket.raiser?.departments?.name
                        ? ` (${ticket.raiser.departments.name})`
                        : ''}
                      {' · '}
                      {formatDateTime(ticket.created_at)}
                      {ticket.assignee ? ` · with ${ticket.assignee.full_name}` : ''}
                      {ticket.resolved_at ? ` · resolved ${formatDateTime(ticket.resolved_at)}` : ''}
                    </p>
                  </div>

                  {canTriage && (
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <label className="sr-only" htmlFor={`assign-${ticket.id}`}>
                        Assign this ticket
                      </label>
                      <select
                        id={`assign-${ticket.id}`}
                        value={ticket.assigned_to ?? ''}
                        onChange={(e) =>
                          patch(ticket.id, { assigned_to: e.target.value || null }, 'assign')
                        }
                        disabled={busy === ticket.id + 'assign'}
                        className="rounded-lg border border-border-subtle bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand-gold disabled:opacity-60"
                      >
                        <option value="">Unassigned</option>
                        {assignees.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.full_name}
                          </option>
                        ))}
                      </select>

                      <div className="flex flex-wrap justify-end gap-1.5">
                        {moves.map((next) => (
                          <button
                            key={next}
                            onClick={() => patch(ticket.id, { status: next }, next)}
                            disabled={busy === ticket.id + next}
                            className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors disabled:opacity-60 ${
                              next === 'resolved'
                                ? 'bg-status-success text-white hover:bg-status-success'
                                : 'border border-border-subtle text-text-muted hover:bg-surface-bg'
                            }`}
                          >
                            {busy === ticket.id + next
                              ? 'Saving…'
                              : next === 'in_progress' && ticket.status === 'resolved'
                                ? 'Reopen'
                                : IT_TICKET_STATUS_LABELS[next]}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
