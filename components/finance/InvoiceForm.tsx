'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatCurrency, INVOICE_TYPE_LABELS } from '@/lib/format'
import { INVOICE_TYPES } from '@/lib/finance/constants'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

export interface CustomerOption {
  id: string
  name: string
}

/** A closed deal or completed installation offered as an invoice source. */
export interface HandoffOption {
  kind: 'deal' | 'installation'
  source_id: string
  customer_id: string
  customer_name: string | null
  amount: number | null
}

/**
 * Creates an invoice. Can start from a closed-deal / completed-installation handoff
 * (pre-fills customer + amount from the source, links deal_closure_id / installation_id) or
 * standalone. total_amount is previewed live from amount + GST but NEVER sent — the DB
 * generates it. issued_by is the session user, set server-side.
 */
export function InvoiceForm({
  customers,
  handoffs = [],
  initialHandoff,
}: {
  customers: CustomerOption[]
  handoffs?: HandoffOption[]
  initialHandoff?: string
}) {
  const router = useRouter()

  // Resolve a ?handoff=kind:source_id param (a dashboard "Bill →" link) to its row once, so
  // the form opens pre-filled instead of empty. An unmatched param falls back to standalone.
  const preselected =
    initialHandoff && handoffs.length
      ? handoffs.find((h) => `${h.kind}:${h.source_id}` === initialHandoff) ?? null
      : null

  const [customerId, setCustomerId] = useState(preselected?.customer_id ?? '')
  const [dealId, setDealId] = useState<string | null>(
    preselected?.kind === 'deal' ? preselected.source_id : null,
  )
  const [installId, setInstallId] = useState<string | null>(
    preselected?.kind === 'installation' ? preselected.source_id : null,
  )
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceType, setInvoiceType] = useState('final')
  const [amount, setAmount] = useState(preselected?.amount != null ? String(preselected.amount) : '')
  const [gst, setGst] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const amountNum = Number(amount) || 0
  const gstNum = Number(gst) || 0
  const total = amountNum + gstNum

  function applyHandoff(value: string) {
    if (!value) {
      setDealId(null)
      setInstallId(null)
      return
    }
    const [kind, id] = value.split(':')
    const h = handoffs.find((x) => x.kind === kind && x.source_id === id)
    if (!h) return
    setCustomerId(h.customer_id)
    if (h.amount != null) setAmount(String(h.amount))
    if (kind === 'deal') {
      setDealId(id)
      setInstallId(null)
    } else {
      setInstallId(id)
      setDealId(null)
    }
  }

  async function save() {
    if (!customerId) return setError('Select a customer.')
    if (invoiceNumber.trim().length < 1) return setError('Enter an invoice number.')
    if (amountNum <= 0) return setError('Enter an amount greater than zero.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/invoices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_id: customerId,
        deal_closure_id: dealId,
        installation_id: installId,
        invoice_number: invoiceNumber.trim(),
        invoice_type: invoiceType,
        amount: amountNum,
        gst_amount: gstNum,
        due_date: dueDate || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the invoice.')
      return
    }
    router.push('/finance/invoices')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      {handoffs.length > 0 && (
        <div>
          <label htmlFor="inv-handoff" className={labelClass}>
            Convert from a completed deal or installation
          </label>
          <select
            id="inv-handoff"
            defaultValue={preselected ? `${preselected.kind}:${preselected.source_id}` : ''}
            onChange={(e) => applyHandoff(e.target.value)}
            className={inputClass}
          >
            <option value="">Start a standalone invoice…</option>
            {handoffs.map((h) => (
              <option key={`${h.kind}:${h.source_id}`} value={`${h.kind}:${h.source_id}`}>
                {h.kind === 'deal' ? 'Deal' : 'Installation'} · {h.customer_name ?? 'Customer'}
                {h.amount != null ? ` · ${formatCurrency(h.amount)}` : ''}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            Pre-fills the customer and amount and links the invoice back to the source.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="inv-customer" className={labelClass}>
            Customer
          </label>
          <select
            id="inv-customer"
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="inv-number" className={labelClass}>
            Invoice number
          </label>
          <input
            id="inv-number"
            value={invoiceNumber}
            onChange={(e) => setInvoiceNumber(e.target.value)}
            placeholder="e.g. INV-2026-0001"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="inv-type" className={labelClass}>
            Type
          </label>
          <select
            id="inv-type"
            value={invoiceType}
            onChange={(e) => setInvoiceType(e.target.value)}
            className={inputClass}
          >
            {INVOICE_TYPES.map((t) => (
              <option key={t} value={t}>
                {INVOICE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="inv-due" className={labelClass}>
            Due date
          </label>
          <input
            id="inv-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="inv-amount" className={labelClass}>
            Amount (excl. GST)
          </label>
          <input
            id="inv-amount"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="inv-gst" className={labelClass}>
            GST amount
          </label>
          <input
            id="inv-gst"
            type="number"
            min="0"
            step="0.01"
            value={gst}
            onChange={(e) => setGst(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="rounded-lg border border-border-subtle bg-surface-bg px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="text-text-muted">Total (generated by the system)</span>
          <span className="font-semibold text-brand-slate">{formatCurrency(total)}</span>
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create invoice'}
      </button>
    </div>
  )
}
