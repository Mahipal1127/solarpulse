'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SUBSIDY_SCHEMES, SUBSIDY_SCHEME_LABELS } from '@/lib/discom/constants'
import { formatDate } from '@/lib/format'
import type { CompletedInstallationOption } from '@/lib/discom/queries'
import type { DiscomEmployee } from '@/lib/discom/dashboard'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Opens a subsidy case from a completed installation. Same handoff shape as the
 * net-metering form; adds the scheme and an optional eligible-subsidy amount. An
 * install whose subsidy is already started (for the chosen scheme) is disabled; the
 * server enforces uniqueness on (installation, scheme) regardless.
 */
export function SubsidyForm({
  installations,
  liaisons,
}: {
  installations: CompletedInstallationOption[]
  liaisons: DiscomEmployee[]
}) {
  const router = useRouter()
  const [installationId, setInstallationId] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [scheme, setScheme] = useState<string>(SUBSIDY_SCHEMES[0])
  const [applicationReference, setApplicationReference] = useState('')
  const [eligibleAmount, setEligibleAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = installations.find((i) => i.id === installationId)

  async function save() {
    if (!installationId) return setError('Select a completed installation.')
    if (!assignedTo) return setError('Assign a liaison executive.')

    const amount = eligibleAmount.trim() ? Number(eligibleAmount) : null
    if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
      return setError('Eligible amount must be a non-negative number.')
    }

    setPending(true)
    setError(null)

    const res = await fetch('/api/subsidy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        assigned_to: assignedTo,
        scheme,
        application_reference: applicationReference.trim() || null,
        eligible_subsidy_amount: amount,
        notes: notes.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the subsidy case.')
      return
    }

    router.push(`/discom/subsidy/${body.subsidyCase.id}`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="sb-install" className={labelClass}>
          Completed installation
        </label>
        <select
          id="sb-install"
          value={installationId}
          onChange={(e) => setInstallationId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select…</option>
          {installations.map((i) => (
            <option key={i.id} value={i.id} disabled={i.hasSubsidy}>
              {i.customer?.name ?? 'Unknown'}
              {i.address ? ` — ${i.address}` : ''}
              {i.completed_date ? ` (completed ${formatDate(i.completed_date)})` : ''}
              {i.hasSubsidy ? ' — already started' : ''}
            </option>
          ))}
        </select>
        {installations.length === 0 && (
          <p className="mt-1 text-xs text-text-muted">
            No completed installations are available for a subsidy claim yet.
          </p>
        )}
      </div>

      {selected && (
        <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
          Customer <span className="font-medium text-brand-slate">{selected.customer?.name}</span>{' '}
          will be linked automatically.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sb-liaison" className={labelClass}>
            Assign liaison
          </label>
          <select
            id="sb-liaison"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {liaisons.map((l) => (
              <option key={l.id} value={l.id}>
                {l.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="sb-scheme" className={labelClass}>
            Scheme
          </label>
          <select
            id="sb-scheme"
            value={scheme}
            onChange={(e) => setScheme(e.target.value)}
            className={inputClass}
          >
            {SUBSIDY_SCHEMES.map((s) => (
              <option key={s} value={s}>
                {SUBSIDY_SCHEME_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sb-ref" className={labelClass}>
            Application reference
          </label>
          <input
            id="sb-ref"
            value={applicationReference}
            onChange={(e) => setApplicationReference(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="sb-eligible" className={labelClass}>
            Eligible amount (₹)
          </label>
          <input
            id="sb-eligible"
            type="number"
            min="0"
            step="0.01"
            value={eligibleAmount}
            onChange={(e) => setEligibleAmount(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="sb-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="sb-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Open subsidy case'}
      </button>
    </div>
  )
}
