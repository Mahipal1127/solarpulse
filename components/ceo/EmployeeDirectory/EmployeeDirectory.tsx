'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_STYLES } from '@/lib/format'
import type { DirectoryEntry } from '@/lib/hr/profile'
import type { EmploymentStatus } from '@/lib/types'

/**
 * The CEO's org-wide employee directory. Each row links to that person's Profile Board
 * (/employees/[id], the CEO route) and shows a task-completion indicator. Filterable by name /
 * designation and by department, so a large roster stays navigable. Pure client-side filtering
 * over the already-loaded list — the data is not sensitive-tier (see getEmployeeDirectory) and the
 * set is small enough that a round-trip per keystroke would be wasteful.
 */
export function EmployeeDirectory({ entries }: { entries: DirectoryEntry[] }) {
  const [query, setQuery] = useState('')
  const [dept, setDept] = useState('')

  const departments = useMemo(
    () => Array.from(new Set(entries.map((e) => e.departmentName).filter(Boolean))).sort() as string[],
    [entries]
  )

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return entries.filter((e) => {
      if (dept && e.departmentName !== dept) return false
      if (!q) return true
      return (
        e.fullName.toLowerCase().includes(q) ||
        (e.designation ?? '').toLowerCase().includes(q)
      )
    })
  }, [entries, query, dept])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or designation…"
          className="min-w-[220px] flex-1 rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
        />
        <select
          value={dept}
          onChange={(e) => setDept(e.target.value)}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
        >
          <option value="">All departments</option>
          {departments.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState title="No matches" description="Try a different search or department." />
      ) : (
        <div className="divide-y divide-border-subtle">
          {filtered.map((e) => (
            <div key={e.employeeId} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <Link
                  href={`/employees/${e.employeeId}`}
                  className="text-sm font-medium text-brand-slate hover:text-brand-gold hover:underline"
                >
                  {e.fullName}
                </Link>
                <p className="mt-0.5 text-xs text-text-muted">
                  {e.designation ?? 'No designation'}
                  {e.departmentName ? ` · ${e.departmentName}` : ''}
                </p>
              </div>

              <div className="flex items-center gap-4">
                <div className="text-right">
                  <p className="text-sm font-semibold text-brand-slate">
                    {e.completionRate === null ? '—' : `${e.completionRate}%`}
                  </p>
                  <p className="text-[11px] text-text-muted">
                    {e.taskCount > 0 ? `${e.taskCount} tasks / 30d` : 'no tasks'}
                  </p>
                </div>
                <Badge className={EMPLOYMENT_STATUS_STYLES[e.employmentStatus as EmploymentStatus]}>
                  {EMPLOYMENT_STATUS_LABELS[e.employmentStatus as EmploymentStatus] ??
                    e.employmentStatus}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
