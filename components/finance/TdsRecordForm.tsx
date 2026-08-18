'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Records a TDS deduction — who was paid, the gross amount, the tax withheld, and when. It
 * starts un-deposited; the list marks it deposited once it's paid to the government.
 */
export function TdsRecordForm() {
  const router = useRouter()
  const [deducteeName, setDeducteeName] = useState('')
  const [section, setSection] = useState('')
  const [amountPaid, setAmountPaid] = useState('')
  const [tdsDeducted, setTdsDeducted] = useState('')
  const [deductionDate, setDeductionDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (deducteeName.trim().length < 1) return setError('Enter the deductee name.')
    if ((Number(amountPaid) || 0) <= 0) return setError('Enter the amount paid.')
    if (!deductionDate) return setError('Pick the deduction date.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/tax/tds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        deductee_name: deducteeName.trim(),
        section: section.trim() || null,
        amount_paid: Number(amountPaid),
        tds_deducted: Number(tdsDeducted) || 0,
        deduction_date: deductionDate,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not record the TDS entry.')
      return
    }
    setDeducteeName('')
    setSection('')
    setAmountPaid('')
    setTdsDeducted('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="tds-name" className={labelClass}>
            Deductee name
          </label>
          <input
            id="tds-name"
            value={deducteeName}
            onChange={(e) => setDeducteeName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tds-section" className={labelClass}>
            Section
          </label>
          <input
            id="tds-section"
            value={section}
            onChange={(e) => setSection(e.target.value)}
            placeholder="e.g. 194C (optional)"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tds-paid" className={labelClass}>
            Amount paid (gross)
          </label>
          <input
            id="tds-paid"
            type="number"
            min="0"
            step="0.01"
            value={amountPaid}
            onChange={(e) => setAmountPaid(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tds-deducted" className={labelClass}>
            TDS deducted
          </label>
          <input
            id="tds-deducted"
            type="number"
            min="0"
            step="0.01"
            value={tdsDeducted}
            onChange={(e) => setTdsDeducted(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="tds-date" className={labelClass}>
            Deduction date
          </label>
          <input
            id="tds-date"
            type="date"
            value={deductionDate}
            onChange={(e) => setDeductionDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Recording…' : 'Record TDS'}
      </button>
    </div>
  )
}
