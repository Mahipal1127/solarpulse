'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { TENDER_STATUS_LABELS } from '@/lib/format'
import type { TenderStatus } from '@/lib/types'

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  ...(Object.keys(TENDER_STATUS_LABELS) as TenderStatus[]).map((s) => ({
    value: s,
    label: TENDER_STATUS_LABELS[s],
  })),
]

const selectClass =
  'rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-gold'

export function TenderFilters({
  employees,
}: {
  employees: { id: string; full_name: string }[]
}) {
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
        aria-label="Filter by assigned employee"
        className={selectClass}
        value={searchParams.get('assignee') ?? ''}
        onChange={(e) => setParam('assignee', e.target.value)}
      >
        <option value="">All assignees</option>
        <option value="unassigned">Unassigned</option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.full_name}
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
