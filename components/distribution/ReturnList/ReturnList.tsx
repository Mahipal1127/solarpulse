'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  formatQuantity,
  MATERIAL_CATEGORY_LABELS,
  RETURN_STATUS_STYLES,
  RETURN_STATUS_LABELS,
  RETURN_REASON_LABELS,
  MATERIAL_CONDITION_STYLES,
  MATERIAL_CONDITION_LABELS,
} from '@/lib/format'
import { RETURN_TRANSITIONS } from '@/lib/distribution/constants'
import type { MaterialReturn, MaterialReturnStatus } from '@/lib/types'

export type ReturnRow = MaterialReturn & {
  dispatch: { id: string; dispatch_number: string } | null
  lead: { id: string; name: string } | null
  returner: { full_name: string } | null
}

export function ReturnList({
  returns,
  readOnly,
}: {
  returns: ReturnRow[]
  readOnly: boolean
}) {
  const [status, setStatus] = useState('')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return returns.filter((r) => {
      if (status && r.status !== status) return false
      if (!q) return true
      return (
        r.item_name.toLowerCase().includes(q) ||
        (r.lead?.name ?? '').toLowerCase().includes(q) ||
        (r.dispatch?.dispatch_number ?? '').toLowerCase().includes(q)
      )
    })
  }, [returns, status, query])

  const pendingCount = returns.filter((r) => r.status === 'pending').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search item, project or dispatch"
          aria-label="Search returns"
          className="min-w-52 flex-1 rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        />

        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Filter by status"
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold"
        >
          <option value="">All statuses</option>
          {(Object.keys(RETURN_STATUS_LABELS) as MaterialReturnStatus[]).map((s) => (
            <option key={s} value={s}>
              {RETURN_STATUS_LABELS[s]}
            </option>
          ))}
        </select>

        {pendingCount > 0 && (
          <span className="text-xs font-medium text-status-warning">
            {pendingCount} awaiting check-in
          </span>
        )}

        {!readOnly && (
          <Link
            href="/distribution/returns/new"
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            Log return
          </Link>
        )}
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={returns.length === 0 ? 'No returns logged' : 'No returns match these filters'}
          description={
            returns.length === 0
              ? 'Material coming back from site gets logged here — excess, damaged, or wrong item.'
              : 'Try a different status or search.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle overflow-hidden rounded-xl border border-border-subtle bg-white shadow-sm">
          {filtered.map((materialReturn) => (
            <ReturnRowItem
              key={materialReturn.id}
              materialReturn={materialReturn}
              readOnly={readOnly}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function ReturnRowItem({
  materialReturn,
  readOnly,
}: {
  materialReturn: ReturnRow
  readOnly: boolean
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<MaterialReturnStatus | null>(null)
  const [error, setError] = useState<string | null>(null)

  const moves = RETURN_TRANSITIONS[materialReturn.status] ?? []

  async function move(next: MaterialReturnStatus) {
    setBusy(next)
    setError(null)

    const res = await fetch(`/api/returns/${materialReturn.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    const body = await res.json().catch(() => ({}))
    setBusy(null)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the return.')
      return
    }

    router.refresh()
  }

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-brand-slate">{materialReturn.item_name}</span>
          <span className="text-sm text-text-muted">
            {formatQuantity(materialReturn.quantity, materialReturn.unit)}
          </span>
          <Badge className={RETURN_STATUS_STYLES[materialReturn.status]}>
            {RETURN_STATUS_LABELS[materialReturn.status]}
          </Badge>
          <Badge className={MATERIAL_CONDITION_STYLES[materialReturn.condition]}>
            {MATERIAL_CONDITION_LABELS[materialReturn.condition]}
          </Badge>
        </div>

        <p className="mt-1 text-xs text-text-muted">
          {materialReturn.reason
            ? `${RETURN_REASON_LABELS[materialReturn.reason] ?? materialReturn.reason} · `
            : ''}
          {materialReturn.category
            ? `${MATERIAL_CATEGORY_LABELS[materialReturn.category] ?? materialReturn.category} · `
            : ''}
          Logged {formatDate(materialReturn.created_at)}
          {materialReturn.returner ? ` by ${materialReturn.returner.full_name}` : ''}
        </p>

        <p className="mt-0.5 text-xs text-text-muted">
          {materialReturn.lead ? materialReturn.lead.name : 'No project'}
          {materialReturn.dispatch && (
            <>
              {' · '}
              <Link
                href={`/distribution/dispatches/${materialReturn.dispatch.id}`}
                className="text-brand-slate hover:text-brand-slate"
              >
                {materialReturn.dispatch.dispatch_number}
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
              disabled={busy !== null}
              /**
               * TODO: 'received_by_store' should eventually be confirmed by the
               * Store department module, not self-confirmed by Distribution. Store
               * physically receives the material, so the check-in is properly
               * theirs to record — but that module does not exist yet. Rather than
               * fake a cross-department confirmation, Distribution marks it in the
               * meantime and the audit row carries self_confirmed: true.
               */
              title={
                next === 'received_by_store'
                  ? 'Recorded by Distribution for now — Store will confirm this once their module exists'
                  : undefined
              }
              className={
                next === 'received_by_store'
                  ? 'rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60'
                  : 'rounded-lg border border-status-danger/25 px-3 py-1.5 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-60'
              }
            >
              {busy === next
                ? 'Saving…'
                : next === 'received_by_store'
                  ? 'Mark received'
                  : 'Reject'}
            </button>
          ))}
        </div>
      )}
    </li>
  )
}
