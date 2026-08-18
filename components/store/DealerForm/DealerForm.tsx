'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { DEALER_RELATIONSHIP_STATUSES } from '@/lib/store/constants'
import { DEALER_STATUS_LABELS } from '@/lib/format'
import type { DealerRelationshipStatus } from '@/lib/types'

/** Creates a dealer contact record. A simple relationship log, not a Sales pipeline. */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function DealerForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [contactPerson, setContactPerson] = useState('')
  const [phone, setPhone] = useState('')
  const [location, setLocation] = useState('')
  const [status, setStatus] = useState<DealerRelationshipStatus>('prospective')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (name.trim().length < 1) {
      setError('Enter a dealer name.')
      return
    }

    setPending(true)
    const res = await fetch('/api/dealers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        contact_person: contactPerson.trim() || null,
        phone: phone.trim() || null,
        location: location.trim() || null,
        relationship_status: status,
        notes: notes.trim() || null,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setPending(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not create the dealer.')
      return
    }

    router.push('/store/dealers')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className={labelClass}>
            Dealer name <span className="text-status-danger">*</span>
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="contact" className={labelClass}>
            Contact person{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="contact"
            value={contactPerson}
            onChange={(e) => setContactPerson(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="location" className={labelClass}>
            Location <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="status" className={labelClass}>
            Relationship
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as DealerRelationshipStatus)}
            className={inputClass}
          >
            {DEALER_RELATIONSHIP_STATUSES.map((s) => (
              <option key={s} value={s}>
                {DEALER_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="notes" className={labelClass}>
            Notes <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <textarea
            id="notes"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className={inputClass}
          />
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
          {pending ? 'Adding…' : 'Add dealer'}
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
