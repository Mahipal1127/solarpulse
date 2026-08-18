'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { COMMON_DISCOM_NAMES } from '@/lib/discom/constants'
import type { DiscomEmployee } from '@/lib/discom/dashboard'
import type { NetMeteringApplication } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Edits the mutable details of a net-metering application. Deliberately has NO status
 * control — status moves only through CaseStatusControl (the /status endpoint), so
 * this form PATCHes everything except status. The server rejects a status field here
 * too, belt-and-braces.
 */
export function NetMeteringDetailsForm({
  application,
  liaisons,
}: {
  application: Pick<
    NetMeteringApplication,
    'id' | 'assigned_to' | 'discom_name' | 'consumer_number' | 'application_number' | 'rejection_reason' | 'notes'
  >
  liaisons: DiscomEmployee[]
}) {
  const router = useRouter()
  const [assignedTo, setAssignedTo] = useState(application.assigned_to)
  const [discomName, setDiscomName] = useState(application.discom_name ?? '')
  const [consumerNumber, setConsumerNumber] = useState(application.consumer_number ?? '')
  const [applicationNumber, setApplicationNumber] = useState(application.application_number ?? '')
  const [rejectionReason, setRejectionReason] = useState(application.rejection_reason ?? '')
  const [notes, setNotes] = useState(application.notes ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    setPending(true)
    setError(null)
    setSaved(false)

    const res = await fetch(`/api/net-metering/${application.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        assigned_to: assignedTo,
        discom_name: discomName.trim() || null,
        consumer_number: consumerNumber.trim() || null,
        application_number: applicationNumber.trim() || null,
        rejection_reason: rejectionReason.trim() || null,
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
        <label htmlFor="nmd-liaison" className={labelClass}>
          Assigned liaison
        </label>
        <select
          id="nmd-liaison"
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="nmd-discom" className={labelClass}>
            DISCOM name
          </label>
          <input
            id="nmd-discom"
            list="discom-names-detail"
            value={discomName}
            onChange={(e) => setDiscomName(e.target.value)}
            className={inputClass}
          />
          <datalist id="discom-names-detail">
            {COMMON_DISCOM_NAMES.map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </div>
        <div>
          <label htmlFor="nmd-consumer" className={labelClass}>
            Consumer number
          </label>
          <input
            id="nmd-consumer"
            value={consumerNumber}
            onChange={(e) => setConsumerNumber(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="nmd-appno" className={labelClass}>
          Application number
        </label>
        <input
          id="nmd-appno"
          value={applicationNumber}
          onChange={(e) => setApplicationNumber(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="nmd-reject" className={labelClass}>
          Rejection reason
        </label>
        <input
          id="nmd-reject"
          value={rejectionReason}
          onChange={(e) => setRejectionReason(e.target.value)}
          placeholder="Only if the board rejected the application"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="nmd-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="nmd-notes"
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
