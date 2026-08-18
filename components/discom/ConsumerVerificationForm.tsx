'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate } from '@/lib/format'
import type { CompletedInstallationOption } from '@/lib/discom/queries'

const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Records a consumer-verification check against a completed installation — the
 * liaison confirming the customer's DISCOM identity matches the paperwork before
 * submission. verified_by and customer_id are set server-side, so this only collects
 * the installation and the three checks.
 */
export function ConsumerVerificationForm({
  installations,
}: {
  installations: CompletedInstallationOption[]
}) {
  const router = useRouter()
  const [installationId, setInstallationId] = useState('')
  const [consumerNumberVerified, setConsumerNumberVerified] = useState(false)
  const [identityVerified, setIdentityVerified] = useState(false)
  const [addressVerified, setAddressVerified] = useState(false)
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!installationId) return setError('Select a completed installation.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/consumer-verification', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        installation_id: installationId,
        consumer_number_verified: consumerNumberVerified,
        identity_verified: identityVerified,
        address_verified: addressVerified,
        notes: notes.trim() || null,
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not record the verification.')
      return
    }

    // Reset for the next check; the list below refreshes.
    setInstallationId('')
    setConsumerNumberVerified(false)
    setIdentityVerified(false)
    setAddressVerified(false)
    setNotes('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="cv-install" className={labelClass}>
          Completed installation
        </label>
        <select
          id="cv-install"
          value={installationId}
          onChange={(e) => setInstallationId(e.target.value)}
          className="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
        >
          <option value="">Select…</option>
          {installations.map((i) => (
            <option key={i.id} value={i.id}>
              {i.customer?.name ?? 'Unknown'}
              {i.address ? ` — ${i.address}` : ''}
              {i.completed_date ? ` (completed ${formatDate(i.completed_date)})` : ''}
            </option>
          ))}
        </select>
      </div>

      <fieldset className="space-y-2">
        <legend className={labelClass}>Checks</legend>
        <CheckRow
          id="cv-consumer"
          label="Consumer number matches the electricity bill"
          checked={consumerNumberVerified}
          onChange={setConsumerNumberVerified}
        />
        <CheckRow
          id="cv-identity"
          label="Identity proof matches the account holder"
          checked={identityVerified}
          onChange={setIdentityVerified}
        />
        <CheckRow
          id="cv-address"
          label="Address matches the installation site"
          checked={addressVerified}
          onChange={setAddressVerified}
        />
      </fieldset>

      <div>
        <label htmlFor="cv-notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="cv-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold"
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Recording…' : 'Record verification'}
      </button>
    </div>
  )
}

function CheckRow({
  id,
  label,
  checked,
  onChange,
}: {
  id: string
  label: string
  checked: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2.5 text-sm text-brand-slate">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 rounded border-border-subtle text-brand-gold focus:ring-brand-gold"
      />
      {label}
    </label>
  )
}
