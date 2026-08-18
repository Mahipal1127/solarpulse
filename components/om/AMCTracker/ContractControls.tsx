'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AmcStatus } from '@/lib/types'
import type { OMEmployee } from '@/lib/om/dashboard'

const inputClass =
  'w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Manage one AMC contract: reassign the responsible engineer, extend the end date
 * (which is what moves it out of expiring-soon/expired, since those are derived from
 * the date), and cancel. Cancelling is the one guarded action — it's the contract
 * ending early, so it asks first.
 */
export function ContractControls({
  contractId,
  status,
  endDate,
  assignedTo,
  engineers,
}: {
  contractId: string
  status: AmcStatus
  endDate: string
  assignedTo: string | null
  engineers: OMEmployee[]
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [extendDate, setExtendDate] = useState(endDate)
  const [confirmingCancel, setConfirmingCancel] = useState(false)

  async function patch(body: Record<string, unknown>) {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/amc/${contractId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setPending(false)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not update the contract.')
      return false
    }

    router.refresh()
    return true
  }

  if (status === 'cancelled') {
    return (
      <p className="text-xs text-text-muted">
        This contract is cancelled. Nothing further can be changed on it.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="cc-eng" className={labelClass}>
          Responsible engineer
        </label>
        <select
          id="cc-eng"
          value={assignedTo ?? ''}
          disabled={pending}
          onChange={(e) => patch({ assigned_to: e.target.value || null })}
          className={inputClass}
        >
          <option value="">Unassigned</option>
          {engineers.map((e) => (
            <option key={e.id} value={e.id}>
              {e.full_name}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="cc-end" className={labelClass}>
          End date
        </label>
        <div className="flex items-end gap-2">
          <input
            id="cc-end"
            type="date"
            value={extendDate}
            onChange={(e) => setExtendDate(e.target.value)}
            className={inputClass}
          />
          <button
            onClick={() => patch({ end_date: extendDate })}
            disabled={pending || extendDate === endDate}
            className="shrink-0 rounded-lg border border-border-subtle px-3 py-2 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold hover:text-brand-gold disabled:opacity-50"
          >
            Update
          </button>
        </div>
        <p className="mt-1 text-xs text-text-muted">
          Expiry is worked out from this date — extend it to renew.
        </p>
      </div>

      <div className="border-t border-border-subtle pt-3">
        {confirmingCancel ? (
          <div className="space-y-2">
            <p className="text-xs text-text-muted">
              Cancel this contract? Its visit history stays on record.
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={async () => {
                  const ok = await patch({ status: 'cancelled' })
                  if (ok) setConfirmingCancel(false)
                }}
                disabled={pending}
                className="rounded-lg bg-status-danger px-3 py-1.5 text-xs font-medium text-white transition-colors disabled:opacity-60"
              >
                Yes, cancel it
              </button>
              <button
                onClick={() => setConfirmingCancel(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                Keep it
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setConfirmingCancel(true)}
            className="text-xs font-medium text-status-danger hover:underline"
          >
            Cancel contract
          </button>
        )}
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
