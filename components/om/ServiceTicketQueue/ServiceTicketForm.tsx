'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SERVICE_ISSUE_TYPES } from '@/lib/om/constants'
import { SERVICE_PRIORITY_LABELS, formatIssueType } from '@/lib/format'
import { servicePriority } from '@/lib/validation/schemas'
import type { ServicePriority } from '@/lib/types'
import type { CustomerOption, InstallationOption } from '@/lib/om/queries'

/**
 * Logging a complaint. Staff file these on the customer's behalf — there is no
 * customer-facing portal in v1 (§4) — so the form names the customer rather than
 * inferring one from a session. Linking an installation is optional: a complaint can
 * predate knowing which site it is about.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

const PRIORITIES = servicePriority.options as ServicePriority[]

export function ServiceTicketForm({
  customers,
  installations,
}: {
  customers: CustomerOption[]
  installations: InstallationOption[]
}) {
  const router = useRouter()
  const [customerId, setCustomerId] = useState('')
  const [installationId, setInstallationId] = useState('')
  const [issueType, setIssueType] = useState('')
  const [priority, setPriority] = useState<ServicePriority>('medium')
  const [description, setDescription] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!customerId) {
      setError('Select the customer this complaint is about.')
      return
    }
    if (description.trim().length < 5) {
      setError('Describe the complaint.')
      return
    }

    setPending(true)
    const res = await fetch('/api/service-tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customerId,
        installation_id: installationId || null,
        issue_type: issueType || null,
        priority,
        description: description.trim(),
      }),
    })
    const body = await res.json()
    setPending(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not log the ticket.')
      return
    }

    router.push(`/om/service/${body.ticket.id}`)
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
          <label htmlFor="issue" className={labelClass}>
            Issue type
          </label>
          <select
            id="issue"
            value={issueType}
            onChange={(e) => setIssueType(e.target.value)}
            className={inputClass}
          >
            <option value="">Not categorised</option>
            {SERVICE_ISSUE_TYPES.map((t) => (
              <option key={t} value={t}>
                {formatIssueType(t)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="priority" className={labelClass}>
            Priority
          </label>
          <select
            id="priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as ServicePriority)}
            className={inputClass}
          >
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {SERVICE_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Complaint <span className="text-status-danger">*</span>
        </label>
        <textarea
          id="description"
          rows={4}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What the customer reported — symptoms, when it started, what they have tried."
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
          {pending ? 'Logging…' : 'Log ticket'}
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
