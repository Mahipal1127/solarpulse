'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, PAYMENT_METHOD_LABELS } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/finance/constants'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Records a payment to a vendor against one bill. POSTs to the payment route, which runs
 * record_vendor_payment() — payment + bill-status recompute + cash-flow outflow in one
 * transaction. The payables mirror of ReceiptForm.
 */
export function VendorPaymentForm({
  billId,
  balanceDue,
}: {
  billId: string
  balanceDue: number
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(balanceDue > 0 ? String(balanceDue) : '')
  const [method, setMethod] = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const [paidDate, setPaidDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const amt = Number(amount) || 0
    if (amt <= 0) return setError('Enter an amount greater than zero.')

    setPending(true)
    setError(null)

    const res = await fetch(`/api/purchase-bills/${billId}/payments`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_paid: amt,
        payment_method: method,
        reference_number: reference.trim() || null,
        paid_date: paidDate || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not record the payment.')
      return
    }
    setReference('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="pay-amount" className={labelClass}>
            Amount paid
          </label>
          <input
            id="pay-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
          {balanceDue > 0 && (
            <button
              type="button"
              onClick={() => setAmount(String(balanceDue))}
              className="mt-1 text-xs font-medium text-brand-slate hover:text-brand-gold"
            >
              Pay full balance ({formatCurrency(balanceDue)})
            </button>
          )}
        </div>
        <div>
          <label htmlFor="pay-method" className={labelClass}>
            Payment method
          </label>
          <select
            id="pay-method"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            className={inputClass}
          >
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="pay-ref" className={labelClass}>
            Reference number
          </label>
          <input
            id="pay-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR / cheque no. (optional)"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="pay-date" className={labelClass}>
            Paid on
          </label>
          <input
            id="pay-date"
            type="date"
            value={paidDate}
            onChange={(e) => setPaidDate(e.target.value)}
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
        {pending ? 'Recording…' : 'Record payment'}
      </button>
    </div>
  )
}
