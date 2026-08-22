'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_STYLES,
  formatDateTime,
} from '@/lib/format'
import type { AttendanceStatus } from '@/lib/types'

interface Row {
  id: string
  employeeId: string
  fullName: string
  status: AttendanceStatus
  checkIn: string | null
  checkOut: string | null
  marked: boolean
}

type SortKey = 'name' | 'status' | 'hours'

/**
 * The day's attendance table — sortable, status-filterable, with computed worked hours. Names link
 * to each person's Profile Board. Hours are (check_out − check_in); an open shift (checked in, not
 * out) shows "—", never a running total, matching the performance summary's rule that an open shift
 * contributes no measured hours. Sorting/filtering is client-side over the already-loaded day (one
 * day's rows are few, and a round-trip per sort would be wasteful).
 */
export function AttendanceTable({ rows }: { rows: Row[] }) {
  const [statusFilter, setStatusFilter] = useState<AttendanceStatus | ''>('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [asc, setAsc] = useState(true)

  const hours = (r: Row): number | null => {
    if (!r.checkIn || !r.checkOut) return null
    const ms = new Date(r.checkOut).getTime() - new Date(r.checkIn).getTime()
    return ms > 0 ? Math.round((ms / 3_600_000) * 10) / 10 : null
  }

  const view = useMemo(() => {
    const filtered = statusFilter ? rows.filter((r) => r.status === statusFilter) : rows
    const dir = asc ? 1 : -1
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return dir * a.fullName.localeCompare(b.fullName)
      if (sortKey === 'status') return dir * a.status.localeCompare(b.status)
      // hours: nulls sort last regardless of direction
      const ha = hours(a)
      const hb = hours(b)
      if (ha === null && hb === null) return 0
      if (ha === null) return 1
      if (hb === null) return -1
      return dir * (ha - hb)
    })
  }, [rows, statusFilter, sortKey, asc])

  function toggleSort(key: SortKey) {
    if (sortKey === key) setAsc(!asc)
    else {
      setSortKey(key)
      setAsc(true)
    }
  }

  const arrow = (key: SortKey) => (sortKey === key ? (asc ? ' ↑' : ' ↓') : '')

  const totalHours = useMemo(
    () => view.reduce((sum, r) => sum + (hours(r) ?? 0), 0),
    [view]
  )

  const statuses: AttendanceStatus[] = ['present', 'absent', 'half_day', 'on_leave', 'holiday']

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AttendanceStatus | '')}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm outline-none focus:border-brand-gold"
        >
          <option value="">All statuses</option>
          {statuses.map((s) => (
            <option key={s} value={s}>
              {ATTENDANCE_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <p className="text-xs text-text-muted">
          {view.length} row{view.length === 1 ? '' : 's'} · {Math.round(totalHours * 10) / 10}h total
        </p>
      </div>

      {view.length === 0 ? (
        <EmptyState title="No rows" description="No records match this filter." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                <th className="px-4 py-3 font-semibold">
                  <button onClick={() => toggleSort('name')} className="hover:text-brand-slate">
                    Employee{arrow('name')}
                  </button>
                </th>
                <th className="px-4 py-3 font-semibold">
                  <button onClick={() => toggleSort('status')} className="hover:text-brand-slate">
                    Status{arrow('status')}
                  </button>
                </th>
                <th className="px-4 py-3 font-semibold">Check in</th>
                <th className="px-4 py-3 font-semibold">Check out</th>
                <th className="px-4 py-3 font-semibold">
                  <button onClick={() => toggleSort('hours')} className="hover:text-brand-slate">
                    Hours{arrow('hours')}
                  </button>
                </th>
                <th className="px-4 py-3 font-semibold">Source</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {view.map((r) => {
                const h = hours(r)
                return (
                  <tr key={r.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3">
                      <Link
                        href={`/hr/employees/${r.employeeId}`}
                        className="text-brand-slate hover:text-brand-gold hover:underline"
                      >
                        {r.fullName}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={ATTENDANCE_STATUS_STYLES[r.status]}>
                        {ATTENDANCE_STATUS_LABELS[r.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {r.checkIn ? formatDateTime(r.checkIn) : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {r.checkOut ? formatDateTime(r.checkOut) : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {h === null ? (r.checkIn && !r.checkOut ? 'open' : '—') : `${h}h`}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{r.marked ? 'HR marked' : 'Self'}</td>
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
