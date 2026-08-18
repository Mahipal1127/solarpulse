'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, formatDate } from '@/lib/format'
import type { CustomerOption, ConvertibleDeal } from '@/lib/om/queries'
import type { OMEmployee } from '@/lib/om/dashboard'

/**
 * Creating an installation, two ways. §3.2 makes the deal-closure conversion the
 * primary path — an install usually follows a won deal — but a standalone install
 * (retrofit, warranty rebuild, a job that never went through Sales here) is allowed
 * too, so this toggles between them.
 *
 * The two modes hit different endpoints because they trust the client differently.
 * Convert sends only the deal id + a team lead; the server reads customer, design and
 * system size off the closure itself (create_installation_from_deal), so the browser
 * cannot mislabel whose install this is. Standalone names the customer directly.
 *
 * Status is not on this form. A new installation is always 'assigned'; moving it
 * forward has side effects (stamping actual_start/completed dates) and lives on the
 * detail page, the same shape the Sales lead form uses.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

type Mode = 'convert' | 'standalone'

export function InstallationForm({
  customers,
  deals,
  teamLeads,
}: {
  customers: CustomerOption[]
  deals: ConvertibleDeal[]
  /** O&M roster — the team lead must be a department member (server re-checks). */
  teamLeads: OMEmployee[]
}) {
  const router = useRouter()
  // Default to conversion when there is a deal to convert; otherwise standalone.
  const [mode, setMode] = useState<Mode>(deals.length > 0 ? 'convert' : 'standalone')
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Convert fields
  const [dealId, setDealId] = useState('')
  // Standalone fields
  const [customerId, setCustomerId] = useState('')
  const [systemSize, setSystemSize] = useState('')
  const [address, setAddress] = useState('')
  // Shared
  const [teamLeadId, setTeamLeadId] = useState('')
  const [scheduledStart, setScheduledStart] = useState('')
  const [notes, setNotes] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    if (!teamLeadId) {
      setServerError('Assign a team lead.')
      return
    }

    let endpoint: string
    let payload: Record<string, unknown>

    if (mode === 'convert') {
      if (!dealId) {
        setServerError('Select a closed deal to convert.')
        return
      }
      endpoint = '/api/installations/convert'
      payload = {
        deal_closure_id: dealId,
        team_lead_id: teamLeadId,
        scheduled_start_date: scheduledStart || null,
        notes: notes || null,
      }
    } else {
      if (!customerId) {
        setServerError('Select a customer.')
        return
      }
      endpoint = '/api/installations'
      payload = {
        customer_id: customerId,
        team_lead_id: teamLeadId,
        scheduled_start_date: scheduledStart || null,
        system_size_kw: systemSize ? Number(systemSize) : null,
        address: address || null,
        notes: notes || null,
      }
    }

    setSubmitting(true)
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const body = await res.json()
    setSubmitting(false)

    if (!res.ok) {
      setServerError(body.error ?? 'Could not create the installation.')
      return
    }

    router.push(`/om/installations/${body.installation.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      {/* Mode toggle */}
      <div className="flex gap-2 rounded-lg bg-surface-bg p-1">
        <ModeTab
          active={mode === 'convert'}
          onClick={() => setMode('convert')}
          label="From a closed deal"
          hint={`${deals.length} available`}
        />
        <ModeTab
          active={mode === 'standalone'}
          onClick={() => setMode('standalone')}
          label="Standalone"
          hint="No deal behind it"
        />
      </div>

      {mode === 'convert' ? (
        <div>
          <label htmlFor="deal" className={labelClass}>
            Closed deal <span className="text-status-danger">*</span>
          </label>
          {deals.length === 0 ? (
            <p className="mt-1 rounded-lg bg-surface-bg px-3 py-2.5 text-sm text-text-muted">
              No unconverted closed deals. Switch to Standalone to log an installation without
              one.
            </p>
          ) : (
            <select
              id="deal"
              value={dealId}
              onChange={(e) => setDealId(e.target.value)}
              className={inputClass}
            >
              <option value="">Select a deal…</option>
              {deals.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.customer?.name ?? 'Unknown'} — {formatCurrency(d.final_amount)} ·{' '}
                  {formatDate(d.closed_at)}
                </option>
              ))}
            </select>
          )}
          <p className="mt-1 text-xs text-text-muted">
            Customer, design and system size come from the deal. A standard installation checklist
            is seeded automatically.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
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
        </div>
      )}

      {/* Shared fields */}
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
            <option value="">Select a team lead…</option>
            {teamLeads.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          {teamLeads.length === 0 && (
            <p className="mt-1 text-xs text-text-muted">
              No active users in the Operations &amp; Maintenance department yet.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="start" className={labelClass}>
            Scheduled start
          </label>
          <input
            id="start"
            type="date"
            value={scheduledStart}
            onChange={(e) => setScheduledStart(e.target.value)}
            className={inputClass}
          />
        </div>
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
          placeholder="Access notes, site constraints, what to bring."
          className={inputClass}
        />
      </div>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">
          ⚠ {serverError}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={submitting}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {submitting ? 'Creating…' : 'Create installation'}
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

function ModeTab({
  active,
  onClick,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-1 rounded-md px-3 py-2 text-left transition-colors ${
        active ? 'bg-white shadow-sm' : 'hover:bg-white/50'
      }`}
    >
      <span
        className={`block text-sm font-medium ${active ? 'text-brand-slate' : 'text-text-muted'}`}
      >
        {label}
      </span>
      <span className="block text-xs text-text-muted">{hint}</span>
    </button>
  )
}
