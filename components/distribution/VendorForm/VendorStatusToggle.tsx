'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Vendor } from '@/lib/types'

/**
 * Deactivates or reinstates a vendor. There is no delete: purchase orders
 * reference the vendor by foreign key, so removing the row would either be
 * refused by the database or orphan the paperwork. Deactivating drops it out of
 * the pickers while every past PO still reads correctly.
 *
 * The confirm step spells out that the vendor stays on historical orders, since
 * "deactivate" reads like a delete to anyone who has not seen the schema.
 */
export function VendorStatusToggle({ vendor }: { vendor: Vendor }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(nextActive: boolean) {
    setBusy(true)
    setError(null)

    // Reactivating goes through PATCH; deactivating uses DELETE, which the route
    // maps to is_active = false. Both end at the same soft-delete write.
    const res = nextActive
      ? await fetch(`/api/vendors/${vendor.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ is_active: true }),
        })
      : await fetch(`/api/vendors/${vendor.id}`, { method: 'DELETE' })

    const body = await res.json().catch(() => ({}))
    setBusy(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the vendor.')
      return
    }

    setConfirming(false)
    router.refresh()
  }

  if (!vendor.is_active) {
    return (
      <div className="space-y-2">
        <button
          onClick={() => submit(true)}
          disabled={busy}
          className="rounded-lg border border-status-success/30 bg-status-success/5 px-4 py-2 text-sm font-medium text-status-success transition-colors hover:bg-status-success/10 disabled:opacity-60"
        >
          {busy ? 'Reinstating…' : 'Reinstate vendor'}
        </button>
        {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
      </div>
    )
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
      >
        Deactivate vendor
      </button>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-status-warning/25 bg-status-warning/5 p-4">
      <p className="text-sm text-status-warning">
        Deactivate <strong>{vendor.name}</strong>? They will stop appearing when raising a purchase
        order. Existing purchase orders keep pointing at them — nothing is deleted.
      </p>
      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
      <div className="flex items-center gap-2">
        <button
          onClick={() => submit(false)}
          disabled={busy}
          className="rounded-lg bg-status-warning px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-status-warning disabled:opacity-60"
        >
          {busy ? 'Deactivating…' : 'Deactivate'}
        </button>
        <button
          onClick={() => {
            setConfirming(false)
            setError(null)
          }}
          className="rounded-lg border border-border-subtle bg-white px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Keep active
        </button>
      </div>
    </div>
  )
}
