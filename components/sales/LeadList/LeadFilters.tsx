'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { LEAD_STATUS_LABELS, LEAD_SOURCES, LEAD_SOURCE_LABELS } from '@/lib/format'
import type { LeadStatus } from '@/lib/types'

const STATUSES: { value: string; label: string }[] = [
  { value: '', label: 'All stages' },
  ...(Object.keys(LEAD_STATUS_LABELS) as LeadStatus[]).map((s) => ({
    value: s,
    label: LEAD_STATUS_LABELS[s],
  })),
]

const selectClass =
  'rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-sm outline-none focus:border-brand-gold'

/**
 * `employees` is empty for an executive: they have exactly one possible owner
 * for every lead they can see, so an assignee filter would be a no-op control.
 * The page decides that, not this component.
 */
export function LeadFilters({
  employees = [],
  view,
}: {
  employees?: { id: string; full_name: string }[]
  view: 'board' | 'list'
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

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className={SEGMENT_TRACK}>
        {(['board', 'list'] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setParam('view', v === 'board' ? '' : v)}
            aria-pressed={view === v}
            className={`${segmentClass(view === v)} capitalize`}
          >
            {v}
          </button>
        ))}
      </div>

      <select
        aria-label="Filter by stage"
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
        aria-label="Filter by source"
        className={selectClass}
        value={searchParams.get('source') ?? ''}
        onChange={(e) => setParam('source', e.target.value)}
      >
        <option value="">All sources</option>
        {LEAD_SOURCES.map((s) => (
          <option key={s} value={s}>
            {LEAD_SOURCE_LABELS[s]}
          </option>
        ))}
      </select>

      {employees.length > 0 && (
        <select
          aria-label="Filter by owner"
          className={selectClass}
          value={searchParams.get('owner') ?? ''}
          onChange={(e) => setParam('owner', e.target.value)}
        >
          <option value="">All owners</option>
          <option value="unassigned">Unassigned</option>
          {employees.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </select>
      )}

      <label className="flex items-center gap-2 text-sm text-text-muted">
        <input
          type="checkbox"
          checked={searchParams.get('open') === '1'}
          onChange={(e) => setParam('open', e.target.checked ? '1' : '')}
          className="h-4 w-4 rounded border-border-subtle"
        />
        Open leads only
      </label>
    </div>
  )
}
