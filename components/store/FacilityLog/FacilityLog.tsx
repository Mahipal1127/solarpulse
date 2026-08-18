'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { FACILITY_STATUS_LABELS, FACILITY_STATUS_STYLES, formatDateTime } from '@/lib/format'
import { FACILITY_STATUSES } from '@/lib/store/constants'
import type { FacilityStatus } from '@/lib/types'
import type { FacilityLogWithPeople } from '@/lib/store/dashboard'

/**
 * The facility issue log with inline status control — a lightweight open/in-progress/resolved
 * tracker, not a ticketing product. Resolving stamps who closed it server-side. readOnly (a CEO
 * viewing) drops the control but keeps the list.
 */
export function FacilityLog({
  logs,
  readOnly,
}: {
  logs: FacilityLogWithPeople[]
  readOnly: boolean
}) {
  if (logs.length === 0) {
    return (
      <EmptyState
        title="No issues logged"
        description="Report an office or facility issue to start tracking it."
      />
    )
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {logs.map((log) => (
        <FacilityRow key={log.id} log={log} readOnly={readOnly} />
      ))}
    </ul>
  )
}

function FacilityRow({ log, readOnly }: { log: FacilityLogWithPeople; readOnly: boolean }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function setStatus(status: FacilityStatus) {
    if (status === log.status) return
    setPending(true)
    setError(null)

    const res = await fetch(`/api/facility/${log.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the status.')
      return
    }
    router.refresh()
  }

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-brand-slate">{log.issue}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            Reported by {log.reporter?.full_name ?? '—'} · {formatDateTime(log.created_at)}
            {log.status === 'resolved' && log.resolver
              ? ` · Resolved by ${log.resolver.full_name}`
              : ''}
          </p>
          {error && <p className="mt-1 text-xs text-status-danger">⚠ {error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          {readOnly ? (
            <Badge className={FACILITY_STATUS_STYLES[log.status]}>
              {FACILITY_STATUS_LABELS[log.status]}
            </Badge>
          ) : (
            <select
              value={log.status}
              disabled={pending}
              onChange={(e) => setStatus(e.target.value as FacilityStatus)}
              className="rounded-lg border border-border-subtle bg-surface-card px-3 py-1.5 text-xs font-medium text-brand-slate outline-none focus:border-brand-gold disabled:opacity-60"
            >
              {FACILITY_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {FACILITY_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
    </li>
  )
}
