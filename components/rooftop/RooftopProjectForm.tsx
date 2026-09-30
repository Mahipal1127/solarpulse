'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { CustomerOption } from '@/lib/rooftop/queries'

/**
 * Creating a rooftop project. Status is not on this form: a new site is
 * always 'active' — work is by definition live when a site enters the
 * monitoring board — and moving it forward lives on the detail page, the
 * same shape the Sales lead form and the O&M installation form use.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function RooftopProjectForm({ customers }: { customers: CustomerOption[] }) {
  const router = useRouter()
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const [customerId, setCustomerId] = useState('')
  const [siteAddress, setSiteAddress] = useState('')
  const [siteCity, setSiteCity] = useState('')
  const [siteState, setSiteState] = useState('')
  const [sitePincode, setSitePincode] = useState('')
  const [capacity, setCapacity] = useState('')
  const [goLiveDate, setGoLiveDate] = useState('')
  const [notes, setNotes] = useState('')

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    if (!customerId) {
      setServerError('Select a customer.')
      return
    }
    if (!siteAddress.trim()) {
      setServerError('Enter the site address.')
      return
    }

    setSubmitting(true)
    const res = await fetch('/api/rooftop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customerId,
        site_address: siteAddress,
        site_city: siteCity || null,
        site_state: siteState || null,
        site_pincode: sitePincode || null,
        capacity_kw: capacity ? Number(capacity) : null,
        go_live_date: goLiveDate || null,
        notes: notes || null,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setSubmitting(false)

    if (!res.ok) {
      setServerError(body.error ?? 'Could not create the site.')
      return
    }

    router.push(`/rooftop/projects/${body.project.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div>
        <label htmlFor="customer" className={labelClass}>
          Customer
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
        <label htmlFor="site-address" className={labelClass}>
          Site address
        </label>
        <textarea
          id="site-address"
          value={siteAddress}
          onChange={(e) => setSiteAddress(e.target.value)}
          rows={2}
          placeholder="Where the work is happening"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="site-city" className={labelClass}>
            City
          </label>
          <input
            id="site-city"
            value={siteCity}
            onChange={(e) => setSiteCity(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="site-state" className={labelClass}>
            State
          </label>
          <input
            id="site-state"
            value={siteState}
            onChange={(e) => setSiteState(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="site-pincode" className={labelClass}>
            Pincode
          </label>
          <input
            id="site-pincode"
            value={sitePincode}
            onChange={(e) => setSitePincode(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="capacity" className={labelClass}>
            Capacity (kW)
          </label>
          <input
            id="capacity"
            type="number"
            min="0"
            step="0.01"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="e.g. 5.5"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="go-live" className={labelClass}>
            Go-live date
          </label>
          <input
            id="go-live"
            type="date"
            value={goLiveDate}
            onChange={(e) => setGoLiveDate(e.target.value)}
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
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Anything the department should know about this site"
          className={inputClass}
        />
      </div>

      {serverError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{serverError}</p>
      )}

      <button
        type="submit"
        disabled={submitting}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {submitting ? 'Creating…' : 'Create site'}
      </button>
    </form>
  )
}
