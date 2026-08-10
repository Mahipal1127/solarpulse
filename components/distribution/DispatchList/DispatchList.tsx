'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle } from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  isDispatchRunningLate,
  DISPATCH_STATUS_STYLES,
  DISPATCH_STATUS_LABELS,
} from '@/lib/format'
import type { MaterialDispatch, DispatchStatus } from '@/lib/types'

export type DispatchRow = MaterialDispatch & {
  lead: { id: string; name: string } | null
  dispatcher: { full_name: string } | null
  items: { count: number }[]
}

/**
 * Dispatch register. Every Distribution member sees them all — material movement
 * is a shared department operation, so there is no per-employee tier here and
 * these filters are display only.
 */
export function DispatchList({
  dispatches,
  readOnly,
  /**
   * Sales' view of their own project's material. They get no create button and no
   * status controls: the cross-department policy is select-only.
   */
  viewerIsSales = false,
}: {
  dispatches: DispatchRow[]
  readOnly: boolean
  viewerIsSales?: boolean
}) {
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')
  const [lateOnly, setLateOnly] = useState(false)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return dispatches.filter((d) => {
      if (status && d.status !== status) return false
      if (lateOnly && !isDispatchRunningLate(d)) return false
      if (!q) return true
      return (
        d.dispatch_number.toLowerCase().includes(q) ||
        (d.lead?.name ?? '').toLowerCase().includes(q) ||
        (d.vehicle_details ?? '').toLowerCase().includes(q)
      )
    })
  }, [dispatches, status, query, lateOnly])

  const lateCount = dispatches.filter(isDispatchRunningLate).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search number, project or vehicle"
          aria-label="Search dispatches"
          className="min-w-52 flex-1 rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        >
          <option value="">All statuses</option>
          {(Object.keys(DISPATCH_STATUS_LABELS) as DispatchStatus[]).map((s) => (
            <option key={s} value={s}>
              {DISPATCH_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {lateCount > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
            <input
              type="checkbox"
              checked={lateOnly}
              onChange={(e) => setLateOnly(e.target.checked)}
              className="h-4 w-4 rounded border-border-subtle text-brand-slate "
            />
            Running late ({lateCount})
          </label>
        )}

        {!readOnly && !viewerIsSales && (
          <Link
            href="/distribution/dispatches/new"
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            New dispatch
          </Link>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={dispatches.length === 0 ? 'No dispatches yet' : 'No dispatches match these filters'}
          description={
            dispatches.length === 0
              ? viewerIsSales
                ? 'Nothing has been sent out for your projects yet.'
                : 'Create one from planned allocations, or send material ad hoc.'
              : 'Try a different status or search.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-subtle bg-white shadow-sm">
          <table className="min-w-full divide-y divide-border-subtle">
            <thead className="bg-surface-bg">
              <tr>
                <Th>Dispatch</Th>
                <Th>Project</Th>
                <Th>Status</Th>
                <Th>Vehicle</Th>
                <Th className="text-right">Items</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {filtered.map((dispatch) => {
                const late = isDispatchRunningLate(dispatch)
                return (
                  <tr key={dispatch.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3">
                      {viewerIsSales ? (
                        // Sales can read a dispatch but has no page inside the
                        // Distribution module, so the number is plain text for them.
                        <span className="text-sm font-medium text-brand-slate">
                          {dispatch.dispatch_number}
                        </span>
                      ) : (
                        <Link
                          href={`/distribution/dispatches/${dispatch.id}`}
                          className="text-sm font-medium text-brand-slate hover:text-brand-slate"
                        >
                          {dispatch.dispatch_number}
                        </Link>
                      )}
                      <span className="mt-0.5 block text-xs text-text-muted/60">
                        {dispatch.dispatched_at
                          ? `Left ${formatDate(dispatch.dispatched_at)}`
                          : `Created ${formatDate(dispatch.created_at)}`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {dispatch.lead?.name ?? (
                        <span className="text-text-muted/60">Internal transfer</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Badge className={DISPATCH_STATUS_STYLES[dispatch.status]}>
                          {DISPATCH_STATUS_LABELS[dispatch.status]}
                        </Badge>
                        {late && (
                          <Badge className="inline-flex items-center gap-1 bg-status-warning/10 text-status-warning ring-status-warning/25">
                            <AlertTriangle className="h-3 w-3" />
                            Late
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-sm text-text-muted">
                      {dispatch.vehicle_details || '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-sm text-text-muted">
                      {dispatch.items?.[0]?.count ?? 0}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted ${className}`}
    >
      {children}
    </th>
  )
}
