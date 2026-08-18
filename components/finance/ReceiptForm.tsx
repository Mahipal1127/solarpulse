'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, PAYMENT_METHOD_LABELS } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/finance/constants'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Records a customer payment against one invoice. POSTs to the receipt route, which runs
 * record_customer_receipt() — receipt + invoice-status recompute + cash-flow inflow in one
 * transaction. The balance still due is shown so the user can settle in full with a click.
 */
export function ReceiptForm({
  invoiceId,
  balanceDue,
}: {
  invoiceId: string
  balanceDue: number
}) {
  const router = useRouter()
  const [amount, setAmount] = useState(balanceDue > 0 ? String(balanceDue) : '')
  const [method, setMethod] = useState('bank_transfer')
  const [reference, setReference] = useState('')
  const [receivedDate, setReceivedDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    const amt = Number(amount) || 0
    if (amt <= 0) return setError('Enter an amount greater than zero.')

    setPending(true)
    setError(null)

    const res = await fetch(`/api/invoices/${invoiceId}/receipts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount_received: amt,
        payment_method: method,
        reference_number: reference.trim() || null,
        received_date: receivedDate || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not record the receipt.')
      return
    }
    setReference('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="rcpt-amount" className={labelClass}>
            Amount received
          </label>
          <input
            id="rcpt-amount"
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
              Settle full balance ({formatCurrency(balanceDue)})
            </button>
          )}
        </div>
        <div>
          <label htmlFor="rcpt-method" className={labelClass}>
            Payment method
          </label>
          <select
            id="rcpt-method"
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
          <label htmlFor="rcpt-ref" className={labelClass}>
            Reference number
          </label>
          <input
            id="rcpt-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="UTR / cheque no. (optional)"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="rcpt-date" className={labelClass}>
            Received on
          </label>
          <input
            id="rcpt-date"
            type="date"
            value={receivedDate}
            onChange={(e) => setReceivedDate(e.target.value)}
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
        {pending ? 'Recording…' : 'Record receipt'}
      </button>
    </div>
  )
}
