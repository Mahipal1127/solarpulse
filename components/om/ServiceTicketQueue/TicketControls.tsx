'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SERVICE_TICKET_TRANSITIONS } from '@/lib/om/constants'
import {
  SERVICE_TICKET_STATUS_LABELS,
  SERVICE_PRIORITY_LABELS,
} from '@/lib/format'
import { servicePriority } from '@/lib/validation/schemas'
import type { ServiceTicketStatus, ServicePriority } from '@/lib/types'
import type { OMEmployee } from '@/lib/om/dashboard'

const selectClass =
  'w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

const PRIORITIES = servicePriority.options as ServicePriority[]

/**
 * Assign, reprioritise, and move a ticket. Status buttons offer only the transitions
 * SERVICE_TICKET_TRANSITIONS allows from here — but 'resolved' is special: it needs a
 * service report to exist, a rule the service layer enforces and this cannot see, so
 * the button is present and the server may still refuse it. hasReport lets us dim it
 * with a hint rather than let the click fail blindly.
 */
export function TicketControls({
  ticketId,
  status,
  priority,
  assignedTo,
  roster,
  hasReport,
}: {
  ticketId: string
  status: ServiceTicketStatus
  priority: ServicePriority
  assignedTo: string | null
  roster: OMEmployee[]
  hasReport: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function patch(body: Record<string, unknown>) {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/service-tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setPending(false)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not update the ticket.')
      return
    }

    router.refresh()
  }

  const next = SERVICE_TICKET_TRANSITIONS[status]

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="tc-assignee" className={labelClass}>
          Assigned to
        </label>
        <select
          id="tc-assignee"
          value={assignedTo ?? ''}
          disabled={pending}
          onChange={(e) => patch({ assigned_to: e.target.value || null })}
          className={selectClass}
        >
          <option value="">Unassigned</option>
          {roster.map((r) => (
            <option key={r.id} value={r.id}>
              {r.full_name}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-text-muted">
          Assigning an open ticket moves it to Assigned automatically.
        </p>
      </div>

      <div>
        <label htmlFor="tc-priority" className={labelClass}>
          Priority
        </label>
        <select
          id="tc-priority"
          value={priority}
          disabled={pending}
          onChange={(e) => patch({ priority: e.target.value })}
          className={selectClass}
        >
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {SERVICE_PRIORITY_LABELS[p]}
            </option>
          ))}
        </select>
      </div>

      {next.length > 0 && (
        <div>
          <p className={labelClass}>Move to</p>
          <div className="flex flex-wrap gap-2">
            {next.map((to) => {
              const blockedResolve = to === 'resolved' && !hasReport
              return (
                <button
                  key={to}
                  onClick={() => patch({ status: to })}
                  disabled={pending || blockedResolve}
                  title={
                    blockedResolve
                      ? 'Log a service report before resolving this ticket'
                      : undefined
                  }
                  className="rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold hover:text-brand-gold disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {SERVICE_TICKET_STATUS_LABELS[to]}
                </button>
              )
            })}
          </div>
          {!hasReport && next.includes('resolved') && (
            <p className="mt-1.5 text-xs text-text-muted">
              Resolving needs at least one service report on file.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
