'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Truck } from 'lucide-react'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  formatQuantity,
  MATERIAL_CATEGORY_LABELS,
  ALLOCATION_STATUS_STYLES,
  ALLOCATION_STATUS_LABELS,
} from '@/lib/format'
import { ALLOCATION_TRANSITIONS } from '@/lib/distribution/constants'
import type { MaterialAllocation, AllocationStatus } from '@/lib/types'

export type AllocationRow = MaterialAllocation & {
  lead: { id: string; name: string } | null
  dispatch: { id: string; dispatch_number: string; status: string } | null
}

/**
 * Material planned per project, grouped by the project it is earmarked for —
 * which is how anyone loading a lorry thinks about it, rather than as one flat
 * list of items.
 *
 * The dispatch action per group is a link, not a form: turning allocations into a
 * dispatch has to happen in one transaction (the allocations flip to 'dispatched'
 * and point at the new dispatch in the same statement), so it belongs to the
 * dispatch form rather than to a button here that would have to make two calls.
 */
export function MaterialAllocationBoard({
  allocations,
  readOnly,
}: {
  allocations: AllocationRow[]
  readOnly: boolean
}) {
  const [statusFilter, setStatusFilter] = useState<string>('')
  const [hidePlanned, setHidePlanned] = useState(false)

  const groups = useMemo(() => {
    const filtered = statusFilter
      ? allocations.filter((a) => a.status === statusFilter)
      : allocations

    const byProject = new Map<
      string,
      { id: string | null; name: string; rows: AllocationRow[] }
    >()

    for (const row of filtered) {
      const key = row.lead_id
      const existing = byProject.get(key)
      if (existing) {
        existing.rows.push(row)
      } else {
        byProject.set(key, {
          id: row.lead?.id ?? row.lead_id,
          // A project whose name did not come back means RLS hid the lead — it is
          // no longer closed-won, or was reassigned. The allocation is still real,
          // so it is shown rather than dropped.
          name: row.lead?.name ?? 'Project not visible',
          rows: [row],
        })
      }
    }

    const list = [...byProject.values()]
    return hidePlanned
      ? list.filter((g) => g.rows.some((r) => r.status === 'allocated'))
      : list
  }, [allocations, statusFilter, hidePlanned])

  const pendingCount = allocations.filter((a) => a.status === 'allocated').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          aria-label="Filter by status"
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        >
          <option value="">All statuses</option>
          {(Object.keys(ALLOCATION_STATUS_LABELS) as AllocationStatus[]).map((s) => (
            <option key={s} value={s}>
              {ALLOCATION_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {pendingCount > 0 && (
          <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
            <input
              type="checkbox"
              checked={hidePlanned}
              onChange={(e) => setHidePlanned(e.target.checked)}
              className="h-4 w-4 rounded border-border-subtle text-brand-slate "
            />
            Only projects with material still to send
          </label>
        )}
      </div>

      {groups.length === 0 ? (
        <EmptyState
          title={
            allocations.length === 0
              ? 'Nothing allocated yet'
              : 'No allocations match these filters'
          }
          description={
            allocations.length === 0
              ? 'Plan material against a won project to see it here.'
              : 'Try a different status.'
          }
        />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <ProjectGroup key={group.id ?? group.name} group={group} readOnly={readOnly} />
          ))}
        </div>
      )}
    </div>
  )
}

function ProjectGroup({
  group,
  readOnly,
}: {
  group: { id: string | null; name: string; rows: AllocationRow[] }
  readOnly: boolean
}) {
  const pending = group.rows.filter((r) => r.status === 'allocated')

  return (
    <div className="overflow-hidden rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-surface-bg px-5 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-brand-slate">{group.name}</h3>
          <p className="mt-0.5 text-xs text-text-muted">
            {group.rows.length} item{group.rows.length === 1 ? '' : 's'} ·{' '}
            {pending.length} awaiting dispatch
          </p>
        </div>

        {!readOnly && pending.length > 0 && group.id && (
          <Link
            href={`/distribution/dispatches/new?lead=${group.id}`}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            <Truck className="h-3.5 w-3.5" />
            Dispatch material
          </Link>
        )}
      </div>

      <ul className="divide-y divide-border-subtle">
        {group.rows.map((row) => (
          <AllocationRowItem key={row.id} allocation={row} readOnly={readOnly} />
        ))}
      </ul>
    </div>
  )
}

function AllocationRowItem({
  allocation,
  readOnly,
}: {
  allocation: AllocationRow
  readOnly: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 'dispatched' is deliberately unreachable from here: an allocation only gets
  // there through the dispatch flow, which sets linked_dispatch_id at the same
  // time. Both the endpoint and the transition table refuse it.
  const moves = ALLOCATION_TRANSITIONS[allocation.status] ?? []

  async function move(next: AllocationStatus) {
    setBusy(true)
    setError(null)

    const res = await fetch(`/api/allocations/${allocation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    const body = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the allocation.')
      return
    }

    router.refresh()
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-brand-slate">{allocation.item_name}</span>
          <span className="text-sm text-text-muted">
            {formatQuantity(allocation.quantity, allocation.unit)}
          </span>
          <Badge className={ALLOCATION_STATUS_STYLES[allocation.status]}>
            {ALLOCATION_STATUS_LABELS[allocation.status]}
          </Badge>
        </div>

        <p className="mt-1 text-xs text-text-muted">
          {allocation.category
            ? `${MATERIAL_CATEGORY_LABELS[allocation.category] ?? allocation.category} · `
            : ''}
          Planned {formatDate(allocation.created_at)}
          {allocation.dispatch && (
            <>
              {' · '}
              <Link
                href={`/distribution/dispatches/${allocation.dispatch.id}`}
                className="text-brand-slate hover:text-brand-slate"
              >
                {allocation.dispatch.dispatch_number}
              </Link>
            </>
          )}
        </p>

        {error && <p className="mt-1 text-xs text-status-danger">⚠ {error}</p>}
      </div>

      {!readOnly && moves.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2">
          {moves.map((next) => (
            <button
              key={next}
              onClick={() => move(next)}
              disabled={busy}
              className={
                next === 'cancelled'
                  ? 'rounded-lg border border-status-danger/25 px-3 py-1.5 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-60'
                  : 'rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60'
              }
            >
              {busy ? 'Saving…' : `Mark ${ALLOCATION_STATUS_LABELS[next].toLowerCase()}`}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}
