'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { BID_STATUS_LABELS } from '@/lib/format'
import type { TenderBidStatus } from '@/lib/types'

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All statuses' },
  ...(Object.keys(BID_STATUS_LABELS) as TenderBidStatus[]).map((s) => ({
    value: s,
    label: BID_STATUS_LABELS[s],
  })),
]

const selectClass =
  'rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-gold'

export function BidFilters({ employees }: { employees: { id: string; full_name: string }[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  function setParam(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value) params.set(key, value)
    else params.delete(key)
    router.push(`${pathname}?${params.toString()}`)
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        aria-label="Filter by bid status"
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
    </div>
  )
}
