'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LOGGABLE_MOVEMENT_TYPES, MOVEMENT_REFERENCE_TYPES } from '@/lib/store/constants'
import { STOCK_MOVEMENT_TYPE_LABELS } from '@/lib/format'
import type { StockMovementType, MovementReferenceType } from '@/lib/types'
import type { InventoryItemOption } from '@/lib/store/dashboard'

/**
 * Logs a stock movement — the one and only way a quantity changes. 'damaged' is not offered
 * here: it has its own form so the damage detail is written in the same transaction. An
 * 'adjustment' may be negative (a correction either way); every other type must be positive,
 * and the hint explains the sign so the user knows a Stock Out of 5 removes 5.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function StockMovementForm({
  items,
  initialItemId,
}: {
  items: InventoryItemOption[]
  initialItemId?: string
}) {
  const router = useRouter()
  const [itemId, setItemId] = useState(initialItemId ?? '')
  const [movementType, setMovementType] = useState<StockMovementType>('stock_in')
  const [quantity, setQuantity] = useState('')
  const [referenceType, setReferenceType] = useState<MovementReferenceType | ''>('')
  const [notes, setNotes] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = items.find((i) => i.id === itemId)
  const isAdjustment = movementType === 'adjustment'

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!itemId) {
      setError('Select an item.')
      return
    }
    const qty = Number(quantity)
    if (quantity === '' || Number.isNaN(qty) || qty === 0) {
      setError('Enter a non-zero quantity.')
      return
    }
    if (!isAdjustment && qty < 0) {
      setError('Only an adjustment can be negative.')
      return
    }

    setPending(true)
    const res = await fetch('/api/stock-movements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory_item_id: itemId,
        movement_type: movementType,
        quantity: qty,
        reference_type: referenceType || null,
        notes: notes.trim() || null,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setPending(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not log the movement.')
      return
    }

    router.push('/store/stock-movements')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="item" className={labelClass}>
            Item <span className="text-status-danger">*</span>
          </label>
          <select
            id="item"
            value={itemId}
            onChange={(e) => setItemId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select an item…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name} — {i.current_quantity} {i.unit} in stock
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="type" className={labelClass}>
            Movement
          </label>
          <select
            id="type"
            value={movementType}
            onChange={(e) => setMovementType(e.target.value as StockMovementType)}
            className={inputClass}
          >
            {LOGGABLE_MOVEMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {STOCK_MOVEMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="quantity" className={labelClass}>
            Quantity {selected ? `(${selected.unit})` : ''} <span className="text-status-danger">*</span>
          </label>
          <input
            id="quantity"
            type="number"
            step="any"
            min={isAdjustment ? undefined : '0'}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="reference" className={labelClass}>
            Relates to{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <select
            id="reference"
            value={referenceType}
            onChange={(e) => setReferenceType(e.target.value as MovementReferenceType | '')}
            className={inputClass}
          >
            <option value="">Not linked</option>
            {MOVEMENT_REFERENCE_TYPES.map((r) => (
              <option key={r} value={r}>
                {r.replace(/_/g, ' ')}
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
            placeholder="Anything worth recording about this movement."
            className={inputClass}
          />
        </div>
      </div>

      <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
        {isAdjustment
          ? 'An adjustment corrects the count — enter a negative number to reduce stock, positive to increase it.'
          : 'Enter the quantity moved as a positive number. Stock In and Material Return add to stock; Stock Out and Material Issue remove from it.'}
      </p>

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
          {pending ? 'Logging…' : 'Log movement'}
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
