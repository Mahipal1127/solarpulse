'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/format'
import type { Proposal } from '@/lib/types'

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Closing a deal is one server call, not three. POST /api/leads/[id]/close runs
 * the close_deal() Postgres function, which creates the customer, writes the
 * deal_closures row, and flips the lead to 'won' inside a single statement — so a
 * failure anywhere rolls the whole thing back rather than leaving a closure with
 * no customer.
 *
 * There is deliberately no way to reach 'won' from the plain lead edit form: the
 * update schema omits that status precisely so this is the only path.
 */
export function CloseDealButton({
  leadId,
  leadName,
  proposals,
  suggestedAmount,
}: {
  leadId: string
  leadName: string
  /** Accepted or sent proposals on this lead, to cite in the closure. */
  proposals: Proposal[]
  /** Amount of the most relevant proposal, prefilled as the final figure. */
  suggestedAmount: number | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [finalAmount, setFinalAmount] = useState(suggestedAmount?.toString() ?? '')
  const [proposalId, setProposalId] = useState(proposals[0]?.id ?? '')
  const [address, setAddress] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function close() {
    if (!finalAmount) {
      setError('Enter the final agreed amount.')
      return
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/leads/${leadId}/close`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        final_amount: Number(finalAmount),
        proposal_id: proposalId || null,
        address: address.trim() || null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not close the deal.')
      return
    }

    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-status-success px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-status-success"
      >
        Close deal
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-slate/50 px-4">
          <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-brand-slate">Close the deal for {leadName}?</h3>
            <p className="mt-2 text-sm text-text-muted">
              This creates the customer record and the closure record together, and marks the lead
              Won. A won lead can no longer be edited, so check the amount first.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label htmlFor="cd-amount" className={labelClass}>
                  Final Amount (₹) <span className="text-status-danger">*</span>
                </label>
                <input
                  id="cd-amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={finalAmount}
                  onChange={(e) => setFinalAmount(e.target.value)}
                  className={inputClass}
                />
              </div>

              {proposals.length > 0 && (
                <div>
                  <label htmlFor="cd-proposal" className={labelClass}>
                    Against Proposal
                  </label>
                  <select
                    id="cd-proposal"
                    value={proposalId}
                    onChange={(e) => setProposalId(e.target.value)}
                    className={inputClass}
                  >
                    <option value="">Not linked</option>
                    {proposals.map((p) => (
                      <option key={p.id} value={p.id}>
                        {formatCurrency(p.amount)} · {formatDate(p.created_at)}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label htmlFor="cd-address" className={labelClass}>
                  Installation Address
                </label>
                <textarea
                  id="cd-address"
                  rows={2}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="Where the system goes. Captured now — a lead has no address field, a customer does."
                  className={inputClass}
                />
              </div>
            </div>

            {error && <p className="mt-3 text-xs text-status-danger">⚠ {error}</p>}

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setOpen(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted hover:bg-surface-bg"
              >
                Not yet
              </button>
              <button
                onClick={close}
                disabled={pending}
                className="rounded-lg bg-status-success px-3 py-1.5 text-sm font-medium text-white hover:bg-status-success disabled:opacity-60"
              >
                {pending ? 'Closing…' : 'Close deal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
