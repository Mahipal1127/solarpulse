'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COMMON_DISCOM_NAMES } from '@/lib/discom/constants'
import { formatDate } from '@/lib/format'
import type { CompletedInstallationOption } from '@/lib/discom/queries'
import type { DiscomEmployee } from '@/lib/discom/dashboard'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Opens a net-metering application from a completed installation — the O&M → DISCOM
 * handoff. Only completed installs are offered (the picker source is filtered), and
 * one whose net metering is already started is disabled with a note; the server
 * rejects a duplicate regardless via the unique constraint. Customer is derived from
 * the installation server-side, so it is shown read-only here, never chosen.
 */
export function NetMeteringForm({
  installations,
  liaisons,
  initialInstallationId = '',
}: {
  installations: CompletedInstallationOption[]
  liaisons: DiscomEmployee[]
  /** Preselects the installation picker — set when opened from a pending handoff. */
  initialInstallationId?: string
}) {
  const router = useRouter()
  // Honour the deep-link only if that install is actually offered and not already started.
  const preselect = installations.find((i) => i.id === initialInstallationId && !i.hasNetMetering)
  const [installationId, setInstallationId] = useState(preselect?.id ?? '')
  const [assignedTo, setAssignedTo] = useState('')
  const [discomName, setDiscomName] = useState('')
  const [consumerNumber, setConsumerNumber] = useState('')
  const [applicationNumber, setApplicationNumber] = useState('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = installations.find((i) => i.id === installationId)

  async function save() {
    if (!installationId) return setError('Select a completed installation.')
    if (!assignedTo) return setError('Assign a liaison executive.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/net-metering', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        assigned_to: assignedTo,
        discom_name: discomName.trim() || null,
        consumer_number: consumerNumber.trim() || null,
        application_number: applicationNumber.trim() || null,
        notes: notes.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the application.')
      return
    }

    router.push(`/discom/net-metering/${body.application.id}`)
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="nm-install" className={labelClass}>
          Completed installation
        </label>
        <select
          id="nm-install"
          value={installationId}
          onChange={(e) => setInstallationId(e.target.value)}
          className={inputClass}
        >
          <option value="">Select…</option>
          {installations.map((i) => (
            <option key={i.id} value={i.id} disabled={i.hasNetMetering}>
              {i.customer?.name ?? 'Unknown'}
              {i.address ? ` — ${i.address}` : ''}
              {i.completed_date ? ` (completed ${formatDate(i.completed_date)})` : ''}
              {i.hasNetMetering ? ' — already started' : ''}
            </option>
          ))}
        </select>
        {installations.length === 0 && (
          <p className="mt-1 text-xs text-text-muted">
            No completed installations are waiting for net metering yet.
          </p>
        )}
      </div>

      {selected && (
        <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
          Customer <span className="font-medium text-brand-slate">{selected.customer?.name}</span>{' '}
          will be linked automatically.
        </p>
      )}

      <div>
        <label htmlFor="nm-liaison" className={labelClass}>
          Assign liaison
        </label>
        <select
          id="nm-liaison"
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nm-discom" className={labelClass}>
            DISCOM name
          </label>
          <input
            id="nm-discom"
            list="discom-names"
            value={discomName}
            onChange={(e) => setDiscomName(e.target.value)}
            placeholder="e.g. BESCOM"
            className={inputClass}
          />
          <datalist id="discom-names">
            {COMMON_DISCOM_NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="nm-consumer" className={labelClass}>
            Consumer number
          </label>
          <input
            id="nm-consumer"
            value={consumerNumber}
            onChange={(e) => setConsumerNumber(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="nm-appno" className={labelClass}>
          Application number (if already filed)
        </label>
        <input
          id="nm-appno"
          value={applicationNumber}
          onChange={(e) => setApplicationNumber(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="nm-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="nm-notes"
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
        {pending ? 'Creating…' : 'Open net metering application'}
      </button>
    </div>
  )
}
