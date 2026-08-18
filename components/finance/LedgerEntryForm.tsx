'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LEDGER_ACCOUNT_CATEGORY_LABELS } from '@/lib/format'
import { LEDGER_ACCOUNT_CATEGORIES } from '@/lib/finance/constants'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * A manual ledger entry — lead/CEO only (the page gates, the service re-checks). Most ledger
 * activity arrives through linked records; this is for adjustments and corrections. Exactly
 * one of debit/credit is normally non-zero, and at least one must be positive.
 */
export function LedgerEntryForm() {
  const router = useRouter()
  const [category, setCategory] = useState('other')
  const [description, setDescription] = useState('')
  const [debit, setDebit] = useState('')
  const [credit, setCredit] = useState('')
  const [entryDate, setEntryDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (description.trim().length < 1) return setError('Enter a description.')
    const d = Number(debit) || 0
    const c = Number(credit) || 0
    if (d <= 0 && c <= 0) return setError('Enter a debit or a credit amount.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_category: category,
        description: description.trim(),
        debit: d,
        credit: c,
        entry_date: entryDate || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the entry.')
      return
    }
    setDescription('')
    setDebit('')
    setCredit('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="led-category" className={labelClass}>
            Account category
          </label>
          <select
            id="led-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputClass}
          >
            {LEDGER_ACCOUNT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {LEDGER_ACCOUNT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="led-date" className={labelClass}>
            Entry date
          </label>
          <input
            id="led-date"
            type="date"
            value={entryDate}
            onChange={(e) => setEntryDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="led-debit" className={labelClass}>
            Debit
          </label>
          <input
            id="led-debit"
            type="number"
            min="0"
            step="0.01"
            value={debit}
            onChange={(e) => setDebit(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="led-credit" className={labelClass}>
            Credit
          </label>
          <input
            id="led-credit"
            type="number"
            min="0"
            step="0.01"
            value={credit}
            onChange={(e) => setCredit(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="led-desc" className={labelClass}>
          Description
        </label>
        <input
          id="led-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Add ledger entry'}
      </button>
    </div>
  )
}
