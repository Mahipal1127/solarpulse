'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/primitives'
import { INVOICE_STATUS_LABELS, INVOICE_STATUS_STYLES } from '@/lib/format'
import { INVOICE_SETTABLE_STATUSES } from '@/lib/finance/constants'
import type { InvoiceStatus } from '@/lib/types'

/**
 * The hand-settable slice of an invoice's lifecycle: draft → sent, or cancelled. paid /
 * partially_paid / overdue are system-driven (receipts recompute them, so they are never
 * offered here). Once an invoice is paid/partially_paid it is locked to a read-only badge —
 * you settle it by recording receipts, not by editing status. readOnly drops the control
 * for a CEO viewing the module.
 */
export function InvoiceStatusControl({
  invoiceId,
  status,
  readOnly,
}: {
  invoiceId: string
  status: InvoiceStatus
  readOnly: boolean
}) {
  const router = useRouter()
  const [current, setCurrent] = useState<InvoiceStatus>(status)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const settable =
    current === 'draft' || current === 'sent' || current === 'cancelled'

  if (readOnly || !settable) {
    return (
      <Badge className={INVOICE_STATUS_STYLES[current]}>{INVOICE_STATUS_LABELS[current]}</Badge>
    )
  }

  async function change(next: InvoiceStatus) {
    const prev = current
    setCurrent(next)
    setPending(true)
    setError(null)
    const res = await fetch(`/api/invoices/${invoiceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    setPending(false)
    if (!res.ok) {
      setCurrent(prev)
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update status.')
      return
    }
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={current}
        disabled={pending}
        onChange={(e) => change(e.target.value as InvoiceStatus)}
        className="rounded-lg border border-border-subtle px-2 py-1 text-xs outline-none focus:border-brand-gold disabled:opacity-60"
      >
        {INVOICE_SETTABLE_STATUSES.map((s) => (
          <option key={s} value={s}>
            {INVOICE_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-status-danger">⚠ {error}</span>}
    </div>
  )
}
