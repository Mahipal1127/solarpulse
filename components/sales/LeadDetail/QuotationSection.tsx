'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatCurrency,
  formatDate,
  isQuotationExpired,
  QUOTATION_STATUS_STYLES,
  QUOTATION_STATUS_LABELS,
} from '@/lib/format'
import type { Quotation, QuotationStatus } from '@/lib/types'

const STATUSES: QuotationStatus[] = ['draft', 'sent', 'accepted', 'rejected', 'expired']

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Internal record of what was quoted, to whom, and where it stands. Not a
 * document generator — producing a customer-facing quotation PDF is out of scope
 * for v1 and flagged as a v2 candidate.
 */
export function QuotationSection({
  leadId,
  quotations,
  readOnly,
  leadClosed,
}: {
  leadId: string
  quotations: Quotation[]
  readOnly: boolean
  leadClosed: boolean
}) {
  const [adding, setAdding] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const canAdd = !readOnly && !leadClosed

  return (
    <div className="rounded-xl border border-border-subtle bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-border-subtle px-5 py-4">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Quotations</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {quotations.length} recorded. Marking one Sent advances the lead.
          </p>
        </div>
        {canAdd && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Add quotation
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <QuotationForm
            leadId={leadId}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {quotations.length === 0 && !adding ? (
        <EmptyState
          title="No quotations yet"
          description={
            readOnly
              ? 'Nothing has been quoted against this lead.'
              : leadClosed
                ? 'This lead is closed, so no further quotations can be added.'
                : 'Record what was quoted so the pipeline stage reflects reality.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {quotations.map((quotation) =>
            editingId === quotation.id ? (
              <li key={quotation.id} className="bg-surface-bg px-5 py-4">
                <QuotationForm
                  leadId={leadId}
                  quotation={quotation}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <QuotationRow
                key={quotation.id}
                quotation={quotation}
                readOnly={readOnly}
                onEdit={() => setEditingId(quotation.id)}
              />
            )
          )}
        </ul>
      )}
    </div>
  )
}

function QuotationRow({
  quotation,
  readOnly,
  onEdit,
}: {
  quotation: Quotation
  readOnly: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Derived from valid_until, not from the stored status: a quotation nobody
  // touched still reads as expired once the date passes.
  const expired = isQuotationExpired(quotation)

  async function send() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/quotations/${quotation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'sent' }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the quotation.')
      return
    }

    router.refresh()
  }

  return (
    <li className="px-5 py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold text-brand-slate">
              {formatCurrency(quotation.amount)}
            </span>
            {quotation.system_size_kw !== null && (
              <span className="text-xs text-text-muted">{quotation.system_size_kw} kW</span>
            )}
            <Badge className={QUOTATION_STATUS_STYLES[quotation.status]}>
              {QUOTATION_STATUS_LABELS[quotation.status]}
            </Badge>
            {expired && (
              <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Past validity</Badge>
            )}
          </div>

          <p className="text-xs text-text-muted">
            Quoted {formatDate(quotation.created_at)}
            {quotation.valid_until && ` · Valid until ${formatDate(quotation.valid_until)}`}
          </p>

          {quotation.notes && (
            <p className="text-xs leading-relaxed text-text-muted">{quotation.notes}</p>
          )}
          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            {quotation.status === 'draft' && (
              <button
                onClick={send}
                disabled={pending}
                className="rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
              >
                Mark sent
              </button>
            )}
            <button
              onClick={onEdit}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
            >
              Edit
            </button>
          </div>
        )}
      </div>
    </li>
  )
}

function QuotationForm({
  leadId,
  quotation,
  onDone,
  onCancel,
}: {
  leadId: string
  quotation?: Quotation
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(quotation?.amount?.toString() ?? '')
  const [systemSize, setSystemSize] = useState(quotation?.system_size_kw?.toString() ?? '')
  const [validUntil, setValidUntil] = useState(quotation?.valid_until ?? '')
  const [status, setStatus] = useState<QuotationStatus>(quotation?.status ?? 'draft')
  const [notes, setNotes] = useState(quotation?.notes ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!amount) {
      setError('Enter the quoted amount.')
      return
    }

    setPending(true)
    setError(null)

    const payload: Record<string, unknown> = {
      amount: Number(amount),
      system_size_kw: systemSize ? Number(systemSize) : null,
      // valid_until is a date column, so the input's YYYY-MM-DD passes straight
      // through — no timezone conversion to get wrong.
      valid_until: validUntil || null,
      notes: notes.trim() || null,
    }
    if (quotation) payload.status = status

    const res = await fetch(
      quotation ? `/api/quotations/${quotation.id}` : `/api/leads/${leadId}/quotations`,
      {
        method: quotation ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save the quotation.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <div>
          <label htmlFor="q-amount" className={labelClass}>
            Amount (₹)
          </label>
          <input
            id="q-amount"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="q-size" className={labelClass}>
            System Size (kW)
          </label>
          <input
            id="q-size"
            type="number"
            min={0}
            step="0.1"
            value={systemSize}
            onChange={(e) => setSystemSize(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="q-valid" className={labelClass}>
            Valid Until
          </label>
          <input
            id="q-valid"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
            className={inputClass}
          />
        </div>
        {quotation && (
          <div>
            <label htmlFor="q-status" className={labelClass}>
              Status
            </label>
            <select
              id="q-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as QuotationStatus)}
              className={inputClass}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {QUOTATION_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="q-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="q-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Panel make, inverter, what the price includes."
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
          {pending ? 'Saving…' : quotation ? 'Save quotation' : 'Add quotation'}
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
