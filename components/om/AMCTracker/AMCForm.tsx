'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { VISIT_FREQUENCIES } from '@/lib/om/constants'
import { formatVisitFrequency } from '@/lib/format'
import type { CustomerOption, InstallationOption } from '@/lib/om/queries'
import type { OMEmployee } from '@/lib/om/dashboard'

/**
 * Opening an AMC contract. Dates are required and validated both here and in
 * createAmcContractSchema (end on or after start). Status is not on the form — a new
 * contract is always 'active'; cancelling happens from the detail page. There is no
 * payment collection here by design (§4).
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function AMCForm({
  customers,
  installations,
  engineers,
}: {
  customers: CustomerOption[]
  installations: InstallationOption[]
  engineers: OMEmployee[]
}) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [installationId, setInstallationId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [frequency, setFrequency] = useState<string>('annual')
  const [amount, setAmount] = useState('')
  const [assignedTo, setAssignedTo] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Select the customer this contract covers.')
      return
    }
    if (!startDate || !endDate) {
      setError('Set both a start and end date.')
      return
    }
    if (new Date(endDate) < new Date(startDate)) {
      setError('The end date must be on or after the start date.')
      return
    }

    setPending(true)
    const res = await fetch('/api/amc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customerId,
        installation_id: installationId || null,
        start_date: startDate,
        end_date: endDate,
        visit_frequency: frequency || null,
        amount: amount ? Number(amount) : null,
        assigned_to: assignedTo || null,
      }),
    })
    const body = await res.json()
    setPending(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not create the contract.')
      return
    }

    router.push(`/om/amc/${body.contract.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="customer" className={labelClass}>
            Customer <span className="text-status-danger">*</span>
          </label>
          <select
            id="customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select a customer…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="installation" className={labelClass}>
            Installation{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <select
            id="installation"
            value={installationId}
            onChange={(e) => setInstallationId(e.target.value)}
            className={inputClass}
          >
            <option value="">Not linked</option>
            {installations.map((i) => (
              <option key={i.id} value={i.id}>
                {i.customer?.name ?? 'Unknown'}
                {i.address ? ` — ${i.address}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="start" className={labelClass}>
            Start date <span className="text-status-danger">*</span>
          </label>
          <input
            id="start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="end" className={labelClass}>
            End date <span className="text-status-danger">*</span>
          </label>
          <input
            id="end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="freq" className={labelClass}>
            Visit frequency
          </label>
          <select
            id="freq"
            value={frequency}
            onChange={(e) => setFrequency(e.target.value)}
            className={inputClass}
          >
            {VISIT_FREQUENCIES.map((f) => (
              <option key={f} value={f}>
                {formatVisitFrequency(f)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="amount" className={labelClass}>
            Contract value{' '}
            <span className="font-normal normal-case text-text-muted/60">(₹, optional)</span>
          </label>
          <input
            id="amount"
            type="number"
            min={0}
            step="1"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="assignee" className={labelClass}>
            Responsible engineer{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <select
            id="assignee"
            value={assignedTo}
            onChange={(e) => setAssignedTo(e.target.value)}
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
          {pending ? 'Creating…' : 'Create contract'}
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
