'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatCurrency,
  formatDateTime,
  BID_STATUS_STYLES,
  BID_STATUS_LABELS,
} from '@/lib/format'
import type { TenderBid, TenderBidStatus } from '@/lib/types'

const BID_STATUSES: TenderBidStatus[] = ['draft', 'submitted', 'under_review', 'won', 'lost']

export type BidRow = TenderBid & { assignee: { full_name: string } | null }

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

export function BidSection({
  tenderId,
  bids,
  employees,
  readOnly,
}: {
  tenderId: string
  bids: BidRow[]
  employees: { id: string; full_name: string }[]
  readOnly: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Bids</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {bids.length} bid{bids.length === 1 ? '' : 's'} recorded for this tender
          </p>
        </div>
        {!readOnly && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Add bid
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <BidForm
            tenderId={tenderId}
            employees={employees}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {bids.length === 0 && !adding ? (
        <EmptyState
          title="No bids yet"
          description={
            readOnly
              ? 'The Tender department has not recorded a bid for this tender.'
              : 'Add a bid to start tracking amount, status, and owner.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {bids.map((bid) =>
            editingId === bid.id ? (
              <li key={bid.id} className="bg-surface-bg px-5 py-4">
                <BidForm
                  tenderId={tenderId}
                  bid={bid}
                  employees={employees}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <li key={bid.id} className="flex items-start justify-between gap-4 px-5 py-4">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-brand-slate">
                      {formatCurrency(bid.bid_amount)}
                    </span>
                    <Badge className={BID_STATUS_STYLES[bid.bid_status]}>
                      {BID_STATUS_LABELS[bid.bid_status]}
                    </Badge>
                  </div>
                  <p className="text-xs text-text-muted">
                    {bid.assignee?.full_name ?? 'Unassigned'}
                    {bid.submitted_at ? ` · Submitted ${formatDateTime(bid.submitted_at)}` : ''}
                  </p>
                  {bid.notes && (
                    <p className="text-xs leading-relaxed text-text-muted">{bid.notes}</p>
                  )}
                </div>
                {!readOnly && (
                  <button
                    onClick={() => setEditingId(bid.id)}
                    className="shrink-0 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
                  >
                    Edit
                  </button>
                )}
              </li>
            )
          )}
        </ul>
      )}
    </div>
  )
}

function BidForm({
  tenderId,
  bid,
  employees,
  onDone,
  onCancel,
}: {
  tenderId: string
  bid?: BidRow
  employees: { id: string; full_name: string }[]
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(bid?.bid_amount?.toString() ?? '')
  const [status, setStatus] = useState<TenderBidStatus>(bid?.bid_status ?? 'draft')
  const [assignee, setAssignee] = useState(bid?.assigned_employee_id ?? '')
  const [notes, setNotes] = useState(bid?.notes ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setPending(true)
    setError(null)

    const payload = {
      bid_amount: amount ? Number(amount) : null,
      bid_status: status,
      assigned_employee_id: assignee || null,
      notes: notes.trim() || null,
    }

    const res = await fetch(
      bid ? `/api/bids/${bid.id}` : `/api/tenders/${tenderId}/bids`,
      {
        method: bid ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save the bid.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Bid Amount (₹)
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as TenderBidStatus)}
            className={inputClass}
          >
            {BID_STATUSES.map((s) => (
              <option key={s} value={s}>
                {BID_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">
            Assigned To
          </label>
          <select
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className={inputClass}
          >
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted">
          Notes
        </label>
        <textarea
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={pending}
          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {pending ? 'Saving…' : bid ? 'Save bid' : 'Add bid'}
        </button>
        <button
          onClick={onCancel}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
