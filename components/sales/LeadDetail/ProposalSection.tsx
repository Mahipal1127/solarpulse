'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatCurrency,
  formatDate,
  PROPOSAL_STATUS_STYLES,
  PROPOSAL_STATUS_LABELS,
} from '@/lib/format'
import type { Proposal, ProposalStatus, Quotation } from '@/lib/types'

const STATUSES: ProposalStatus[] = ['draft', 'sent', 'accepted', 'rejected']

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Internal record of the formal offer. Accepting a proposal moves the lead to
 * Negotiation, not to Won — winning requires the closure record, which only the
 * Close Deal action can write.
 */
export function ProposalSection({
  leadId,
  proposals,
  quotations,
  readOnly,
  leadClosed,
}: {
  leadId: string
  proposals: Proposal[]
  /** Same-lead quotations, for the optional citation on a proposal. */
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
          <h2 className="text-sm font-semibold text-brand-slate">Proposals</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            {proposals.length} recorded. Accepting one moves the lead to Negotiation.
          </p>
        </div>
        {canAdd && !adding && (
          <button
            onClick={() => setAdding(true)}
            className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            + Add proposal
          </button>
        )}
      </div>

      {adding && (
        <div className="border-b border-border-subtle bg-surface-bg px-5 py-4">
          <ProposalForm
            leadId={leadId}
            quotations={quotations}
            onDone={() => setAdding(false)}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {proposals.length === 0 && !adding ? (
        <EmptyState
          title="No proposals yet"
          description={
            readOnly
              ? 'No proposal has been put to this customer.'
              : leadClosed
                ? 'This lead is closed, so no further proposals can be added.'
                : 'Add a proposal once a quotation has been agreed in principle.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {proposals.map((proposal) =>
            editingId === proposal.id ? (
              <li key={proposal.id} className="bg-surface-bg px-5 py-4">
                <ProposalForm
                  leadId={leadId}
                  proposal={proposal}
                  quotations={quotations}
                  onDone={() => setEditingId(null)}
                  onCancel={() => setEditingId(null)}
                />
              </li>
            ) : (
              <ProposalRow
                key={proposal.id}
                proposal={proposal}
                quotations={quotations}
                readOnly={readOnly}
                onEdit={() => setEditingId(proposal.id)}
              />
            )
          )}
        </ul>
      )}
    </div>
  )
}

function ProposalRow({
  proposal,
  quotations,
  readOnly,
  onEdit,
}: {
  proposal: Proposal
  quotations: Quotation[]
  readOnly: boolean
  onEdit: () => void
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const citedQuotation = proposal.quotation_id
    ? quotations.find((q) => q.id === proposal.quotation_id)
    : undefined

  async function setStatus(status: ProposalStatus) {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/proposals/${proposal.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the proposal.')
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
              {formatCurrency(proposal.amount)}
            </span>
            <Badge className={PROPOSAL_STATUS_STYLES[proposal.status]}>
              {PROPOSAL_STATUS_LABELS[proposal.status]}
            </Badge>
          </div>

          <p className="text-xs text-text-muted">
            Proposed {formatDate(proposal.created_at)}
            {citedQuotation &&
              ` · Based on the ${formatCurrency(citedQuotation.amount)} quotation`}
          </p>

          {proposal.terms && (
            <p className="whitespace-pre-line text-xs leading-relaxed text-text-muted">
              {proposal.terms}
            </p>
          )}
          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
        </div>

        {!readOnly && (
          <div className="flex shrink-0 items-center gap-2">
            {proposal.status === 'draft' && (
              <button
                onClick={() => setStatus('sent')}
                disabled={pending}
                className="rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
              >
                Mark sent
              </button>
            )}
            {proposal.status === 'sent' && (
              <>
                <button
                  onClick={() => setStatus('accepted')}
                  disabled={pending}
                  className="rounded-lg bg-status-success px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-status-success disabled:opacity-60"
                >
                  Accepted
                </button>
                <button
                  onClick={() => setStatus('rejected')}
                  disabled={pending}
                  className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
                >
                  Rejected
                </button>
              </>
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

function ProposalForm({
  leadId,
  proposal,
  quotations,
  onDone,
  onCancel,
}: {
  leadId: string
  proposal?: Proposal
  quotations: Quotation[]
  onDone: () => void
  onCancel: () => void
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(proposal?.amount?.toString() ?? '')
  const [quotationId, setQuotationId] = useState(proposal?.quotation_id ?? '')
  const [status, setStatus] = useState<ProposalStatus>(proposal?.status ?? 'draft')
  const [terms, setTerms] = useState(proposal?.terms ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** Prefills the amount from the cited quotation, which is the usual case. */
  function pickQuotation(id: string) {
    setQuotationId(id)
    if (!id) return
    const quotation = quotations.find((q) => q.id === id)
    if (quotation && !amount) setAmount(quotation.amount.toString())
  }

  async function save() {
    if (!amount) {
      setError('Enter the proposed amount.')
      return
    }

    setPending(true)
    setError(null)

    const payload: Record<string, unknown> = {
      amount: Number(amount),
      quotation_id: quotationId || null,
      terms: terms.trim() || null,
    }
    if (proposal) payload.status = status

    const res = await fetch(
      proposal ? `/api/proposals/${proposal.id}` : `/api/leads/${leadId}/proposals`,
      {
        method: proposal ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save the proposal.')
      return
    }

    onDone()
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="p-amount" className={labelClass}>
            Amount (₹)
          </label>
          <input
            id="p-amount"
            type="number"
            min={0}
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="p-quotation" className={labelClass}>
            Based on Quotation
          </label>
          <select
            id="p-quotation"
            value={quotationId}
            onChange={(e) => pickQuotation(e.target.value)}
            className={inputClass}
          >
            <option value="">Not linked</option>
            {quotations.map((q) => (
              <option key={q.id} value={q.id}>
                {formatCurrency(q.amount)} · {formatDate(q.created_at)}
              </option>
            ))}
          </select>
        </div>
        {proposal && (
          <div>
            <label htmlFor="p-status" className={labelClass}>
              Status
            </label>
            <select
              id="p-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as ProposalStatus)}
              className={inputClass}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {PROPOSAL_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="p-terms" className={labelClass}>
          Terms
        </label>
        <textarea
          id="p-terms"
          rows={3}
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          placeholder="Payment schedule, warranty, timeline, exclusions."
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
          {pending ? 'Saving…' : proposal ? 'Save proposal' : 'Add proposal'}
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
