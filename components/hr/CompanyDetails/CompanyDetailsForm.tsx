'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check } from 'lucide-react'
import type { CompanyDetails } from '@/lib/types'

/**
 * Edits the company contact footer printed on every ID card. Lead-only in practice —
 * the page only renders this when the viewer can manage, and the PUT re-checks — so
 * there is no read-only variant here.
 *
 * Saving does NOT regenerate existing cards. Copy says so plainly: the new footer
 * applies to cards generated from now on, and an existing card is refreshed by
 * regenerating it from the employee's profile. Pretending a footer edit reprinted
 * every card would be the dishonest UI the ID-card feature is careful to avoid.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold focus:ring-1 focus:ring-brand-slate'

export function CompanyDetailsForm({ details }: { details: CompanyDetails | null }) {
  const router = useRouter()
  const [address, setAddress] = useState(details?.address ?? '')
  const [phone, setPhone] = useState(details?.phone ?? '')
  const [email, setEmail] = useState(details?.email ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  async function save() {
    setSaving(true)
    setError(null)
    setSaved(false)

    const res = await fetch('/api/company-details', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: address.trim() || null,
        phone: phone.trim() || null,
        email: email.trim() || null,
      }),
    })

    setSaving(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not save company details.')
      return
    }
    setSaved(true)
    router.refresh()
  }

  return (
    <div className="space-y-5">
      <div>
        <label htmlFor="cd-address" className="block text-sm font-medium text-text-muted">
          Address
        </label>
        <input
          id="cd-address"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          placeholder="Behind Central Bank of India, Kheme ka Kua, Pal Road, Jodhpur (Raj.)"
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="cd-phone" className="block text-sm font-medium text-text-muted">
            Phone
          </label>
          <input
            id="cd-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+91-97722 22318"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="cd-email" className="block text-sm font-medium text-text-muted">
            E-mail
          </label>
          <input
            id="cd-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="solarpulseindia@gmail.com"
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">{error}</p>
      )}
      {saved && (
        <p className="inline-flex items-center gap-1.5 text-sm text-status-success">
          <Check className="h-4 w-4" /> Saved. New cards use this footer; regenerate an existing card
          to refresh it.
        </p>
      )}

      <button
        onClick={save}
        disabled={saving}
        className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Save company details'}
      </button>
    </div>
  )
}
