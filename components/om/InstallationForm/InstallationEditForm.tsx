'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Installation } from '@/lib/types'
import type { OMEmployee } from '@/lib/om/dashboard'

/**
 * Editing an installation's mutable fields. Deliberately narrower than the update
 * schema: status is NOT here (it lives on the detail page's StatusControl, which
 * stamps dates as it transitions), and customer/deal are fixed at creation — an
 * install belongs to the customer it was created for. What is left is the team lead,
 * the schedule, size, address and notes.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function InstallationEditForm({
  installation,
  teamLeads,
}: {
  installation: Installation
  teamLeads: OMEmployee[]
}) {
  const router = useRouter()
  const [teamLeadId, setTeamLeadId] = useState(installation.team_lead_id)
  const [scheduledStart, setScheduledStart] = useState(installation.scheduled_start_date ?? '')
  const [actualStart, setActualStart] = useState(installation.actual_start_date ?? '')
  const [systemSize, setSystemSize] = useState(installation.system_size_kw?.toString() ?? '')
  const [address, setAddress] = useState(installation.address ?? '')
  const [notes, setNotes] = useState(installation.notes ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setPending(true)
    setError(null)

    const res = await fetch(`/api/installations/${installation.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        team_lead_id: teamLeadId,
        scheduled_start_date: scheduledStart || null,
        actual_start_date: actualStart || null,
        system_size_kw: systemSize ? Number(systemSize) : null,
        address: address || null,
        notes: notes || null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save the installation.')
      return
    }

    router.push(`/om/installations/${installation.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="lead" className={labelClass}>
            Team lead <span className="text-status-danger">*</span>
          </label>
          <select
            id="lead"
            value={teamLeadId}
            onChange={(e) => setTeamLeadId(e.target.value)}
            className={inputClass}
          >
            {teamLeads.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="size" className={labelClass}>
            System size{' '}
            <span className="font-normal normal-case text-text-muted/60">(kW, optional)</span>
          </label>
          <input
            id="size"
            type="number"
            min={0}
            step="0.1"
            value={systemSize}
            onChange={(e) => setSystemSize(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="sched" className={labelClass}>
            Scheduled start
          </label>
          <input
            id="sched"
            type="date"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="actual" className={labelClass}>
            Actual start
          </label>
          <input
            id="actual"
            type="date"
            value={actualStart}
            onChange={(e) => setActualStart(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="address" className={labelClass}>
          Site address
        </label>
        <input
          id="address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">
          ⚠ {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save changes'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
