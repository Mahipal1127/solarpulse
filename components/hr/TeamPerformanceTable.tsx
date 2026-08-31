'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import type { TeamPerformanceRow } from '@/lib/services/performance'

/**
 * The detailed per-employee performance board for the HR lead / CEO. Rows come pre-computed from
 * getTeamPerformanceOverview (strict tier — the page never mounts this for anyone else). Everything
 * here is client-side ergonomics over that data: a name search and column sort so checking one
 * person is quick, plus a completion bar so the numbers read at a glance. No fetching, no mutation.
 */

type SortKey = 'name' | 'completion' | 'present' | 'absent' | 'hours'

/** Sort direction per column: names default A→Z, every metric defaults high→low. */
const DEFAULT_DESC: Record<SortKey, boolean> = {
  name: false,
  completion: true,
  present: true,
  absent: true,
  hours: true,
}

export function TeamPerformanceTable({ rows }: { rows: TeamPerformanceRow[] }) {
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [desc, setDesc] = useState(false)

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q
      ? rows.filter(
          (r) =>
            r.fullName.toLowerCase().includes(q) ||
            (r.designation?.toLowerCase().includes(q) ?? false) ||
            (r.departmentName?.toLowerCase().includes(q) ?? false)
        )
      : rows

    // A null completion rate (no tasks assigned) sorts to the bottom whichever way the arrow points
    // — it is "no data", not "zero", so it should never masquerade as the best or worst performer.
    const value = (r: TeamPerformanceRow): number | null => {
      switch (sortKey) {
        case 'completion':
          return r.tasks.completionRate
        case 'present':
          return r.attendance.present
        case 'absent':
          return r.attendance.absent
        case 'hours':
          return r.attendance.totalHours
        default:
          return null
      }
    }

    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'name') {
        return desc ? b.fullName.localeCompare(a.fullName) : a.fullName.localeCompare(b.fullName)
      }
      const av = value(a)
      const bv = value(b)
      if (av === null && bv === null) return a.fullName.localeCompare(b.fullName)
      if (av === null) return 1
      if (bv === null) return -1
      return desc ? bv - av : av - bv
    })

    return sorted
  }, [rows, query, sortKey, desc])

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setDesc((d) => !d)
    } else {
      setSortKey(key)
      setDesc(DEFAULT_DESC[key])
    }
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No active employees"
        description="Once people are onboarded, their performance analytics appear here."
      />
    )
  }

  return (
    <div className="space-y-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name, role, or department…"
        className="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold sm:max-w-xs"
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
              <SortHeader label="Employee" active={sortKey === 'name'} desc={desc} onClick={() => toggleSort('name')} />
              <SortHeader
                label="Task completion"
                active={sortKey === 'completion'}
                desc={desc}
                onClick={() => toggleSort('completion')}
              />
              <SortHeader label="Present" active={sortKey === 'present'} desc={desc} onClick={() => toggleSort('present')} align="right" />
              <SortHeader label="Absent" active={sortKey === 'absent'} desc={desc} onClick={() => toggleSort('absent')} align="right" />
              <th className="px-4 py-3 text-right font-semibold">Leave</th>
              <SortHeader label="Hours" active={sortKey === 'hours'} desc={desc} onClick={() => toggleSort('hours')} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {visible.map((r) => (
              <tr key={r.employeeId} className="transition-colors hover:bg-surface-bg">
                <td className="px-4 py-3">
                  <Link
                    href={`/hr/employees/${r.employeeId}`}
                    className="font-medium text-brand-slate hover:text-brand-gold hover:underline"
                  >
                    {r.fullName}
                  </Link>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {r.designation ?? '—'}
                    {r.departmentName ? ` · ${r.departmentName}` : ''}
                  </p>
                </td>
                <td className="px-4 py-3">
                  <CompletionCell rate={r.tasks.completionRate} completed={r.tasks.completed} total={r.tasks.total} />
                </td>
                <td className="px-4 py-3 text-right text-brand-slate">{r.attendance.present}</td>
                <td className="px-4 py-3 text-right">
                  {r.attendance.absent > 0 ? (
                    <span className="text-status-danger">{r.attendance.absent}</span>
                  ) : (
                    <span className="text-text-muted">0</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right text-text-muted">{r.attendance.onLeave}</td>
                <td className="px-4 py-3 text-right text-brand-slate">
                  {r.attendance.totalHours}
                  {r.attendance.openShifts > 0 && (
                    <span
                      title={`${r.attendance.openShifts} open shift${r.attendance.openShifts > 1 ? 's' : ''} not counted`}
                      className="ml-1 cursor-help text-xs text-status-warning"
                    >
                      ⚠
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length === 0 && (
        <p className="px-4 py-6 text-center text-sm text-text-muted">No one matches “{query}”.</p>
      )}
    </div>
  )
}

/** Completion rate as a labelled bar. Null (no tasks assigned) reads "—", never a 0% bar. */
function CompletionCell({
  rate,
  completed,
  total,
}: {
  rate: number | null
  completed: number
  total: number
}) {
  if (rate === null) {
    return <span className="text-text-muted">— no tasks</span>
  }

  const tone =
    rate >= 75 ? 'bg-status-success' : rate >= 40 ? 'bg-status-warning' : 'bg-status-danger'

  return (
    <div className="flex items-center gap-2">
      <div className="h-2 w-20 overflow-hidden rounded-full bg-surface-bg" aria-hidden>
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${rate}%` }} />
      </div>
      <span className="tabular-nums text-brand-slate">{rate}%</span>
      <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
        {completed}/{total}
      </Badge>
    </div>
  )
}

function SortHeader({
  label,
  active,
  desc,
  onClick,
  align = 'left',
}: {
  label: string
  active: boolean
  desc: boolean
  onClick: () => void
  align?: 'left' | 'right'
}) {
  return (
    <th className={`px-4 py-3 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button
        onClick={onClick}
        className={`inline-flex items-center gap-1 uppercase tracking-wide transition-colors hover:text-brand-slate ${
          active ? 'text-brand-slate' : ''
        }`}
      >
        {label}
        <span className="text-[10px]">{active ? (desc ? '▼' : '▲') : '↕'}</span>
      </button>
    </th>
  )
}
