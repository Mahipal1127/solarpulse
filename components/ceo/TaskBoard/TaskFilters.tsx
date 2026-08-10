'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import type { Department } from '@/lib/types'

const STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'delayed', label: 'Delayed' },
  { value: 'completed', label: 'Completed' },
  { value: 'archived', label: 'Archived' },
]

const PRIORITIES = [
  { value: '', label: 'All priorities' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const selectClass =
  'rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-gold'

export function TaskFilters({ departments }: { departments: Department[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }

  const overdue = searchParams.get('overdue') === '1'

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        aria-label="Filter by department"
        className={selectClass}
        value={searchParams.get('department') ?? ''}
        onChange={(e) => setParam('department', e.target.value)}
      >
        <option value="">All departments</option>
        {departments.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by status"
        className={selectClass}
        value={searchParams.get('status') ?? ''}
        onChange={(e) => setParam('status', e.target.value)}
      >
        {STATUSES.map((s) => (
          <option key={s.value} value={s.value}>
            {s.label}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by priority"
        className={selectClass}
        value={searchParams.get('priority') ?? ''}
        onChange={(e) => setParam('priority', e.target.value)}
      >
        {PRIORITIES.map((p) => (
          <option key={p.value} value={p.value}>
            {p.label}
          </option>
        ))}
      </select>

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          checked={overdue}
          onChange={(e) => setParam('overdue', e.target.checked ? '1' : '')}
          className="h-4 w-4 rounded border-border-subtle"
        />
        Overdue only
      </label>
    </div>
  )
}
