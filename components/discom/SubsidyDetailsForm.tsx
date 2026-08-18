'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { DiscomEmployee } from '@/lib/discom/dashboard'
import type { SubsidyCase } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Edits the mutable details of a subsidy case, including the money fields (eligible
 * and disbursed amounts). No status control — status moves only through the /status
 * endpoint. The disbursed amount is recorded here rather than inferred by the status
 * change, so a partial or corrected disbursement is captured accurately.
 */
export function SubsidyDetailsForm({
  subsidyCase,
  liaisons,
}: {
  subsidyCase: Pick<
    SubsidyCase,
    'id' | 'assigned_to' | 'application_reference' | 'eligible_subsidy_amount' | 'disbursed_amount' | 'notes'
  >
  liaisons: DiscomEmployee[]
}) {
  const router = useRouter()
  const [assignedTo, setAssignedTo] = useState(subsidyCase.assigned_to)
  const [applicationReference, setApplicationReference] = useState(
    subsidyCase.application_reference ?? ''
  )
  const [eligibleAmount, setEligibleAmount] = useState(
    subsidyCase.eligible_subsidy_amount !== null ? String(subsidyCase.eligible_subsidy_amount) : ''
  )
  const [disbursedAmount, setDisbursedAmount] = useState(
    subsidyCase.disbursed_amount !== null ? String(subsidyCase.disbursed_amount) : ''
  )
  const [notes, setNotes] = useState(subsidyCase.notes ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    const eligible = eligibleAmount.trim() ? Number(eligibleAmount) : null
    const disbursed = disbursedAmount.trim() ? Number(disbursedAmount) : null
    if (eligible !== null && (!Number.isFinite(eligible) || eligible < 0)) {
      return setError('Eligible amount must be a non-negative number.')
    }
    if (disbursed !== null && (!Number.isFinite(disbursed) || disbursed < 0)) {
      return setError('Disbursed amount must be a non-negative number.')
    }

    setPending(true)
    setError(null)
    setSaved(false)

    const res = await fetch(`/api/subsidy/${subsidyCase.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigned_to: assignedTo,
        application_reference: applicationReference.trim() || null,
        eligible_subsidy_amount: eligible,
        disbursed_amount: disbursed,
        notes: notes.trim() || null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save the changes.')
      return
    }

    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="sbd-liaison" className={labelClass}>
          Assigned liaison
        </label>
        <select
          id="sbd-liaison"
          value={assignedTo}
          onChange={(e) => setAssignedTo(e.target.value)}
          className={inputClass}
        >
          {liaisons.map((l) => (
            <option key={l.id} value={l.id}>
              {l.full_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="sbd-ref" className={labelClass}>
          Application reference
        </label>
        <input
          id="sbd-ref"
          value={applicationReference}
          onChange={(e) => setApplicationReference(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sbd-eligible" className={labelClass}>
            Eligible amount (₹)
          </label>
          <input
            id="sbd-eligible"
            type="number"
            min="0"
            step="0.01"
            value={eligibleAmount}
            onChange={(e) => setEligibleAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="sbd-disbursed" className={labelClass}>
            Disbursed amount (₹)
          </label>
          <input
            id="sbd-disbursed"
            type="number"
            min="0"
            step="0.01"
            value={disbursedAmount}
            onChange={(e) => setDisbursedAmount(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="sbd-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="sbd-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
      {saved && <p className="text-xs text-status-success">Saved.</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Save details'}
      </button>
    </div>
  )
}
