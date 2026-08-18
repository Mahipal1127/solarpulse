'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { INVENTORY_CATEGORIES, INVENTORY_UNITS } from '@/lib/store/constants'
import { INVENTORY_CATEGORY_LABELS } from '@/lib/format'
import type { InventoryCategory } from '@/lib/types'

/**
 * Creates an inventory item TYPE — never an opening quantity. Stock only ever arrives through a
 * 'stock_in' movement, so this form deliberately has no quantity field: the reasoning that
 * keeps the count accurate (one ledger, no editable running total) would be undone by letting
 * someone type a starting number here. The hint on the form says so.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function InventoryItemForm() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [category, setCategory] = useState<InventoryCategory>('solar_panel')
  const [sku, setSku] = useState('')
  const [unit, setUnit] = useState('pcs')
  const [reorderThreshold, setReorderThreshold] = useState('')
  const [rackLocation, setRackLocation] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (name.trim().length < 1) {
      setError('Enter an item name.')
      return
    }

    setPending(true)
    const res = await fetch('/api/inventory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        category,
        sku: sku.trim() || null,
        unit: unit.trim() || 'pcs',
        reorder_threshold: reorderThreshold === '' ? null : Number(reorderThreshold),
        rack_location: rackLocation.trim() || null,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setPending(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not create the item.')
      return
    }

    router.push('/store/inventory')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label htmlFor="name" className={labelClass}>
            Item name <span className="text-status-danger">*</span>
          </label>
          <input
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. 540W Mono PERC Panel"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="category" className={labelClass}>
            Category
          </label>
          <select
            id="category"
            value={category}
            onChange={(e) => setCategory(e.target.value as InventoryCategory)}
            className={inputClass}
          >
            {INVENTORY_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {INVENTORY_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="unit" className={labelClass}>
            Unit
          </label>
          <input
            id="unit"
            list="unit-options"
            value={unit}
            onChange={(e) => setUnit(e.target.value)}
            className={inputClass}
          />
          <datalist id="unit-options">
            {INVENTORY_UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </div>

        <div>
          <label htmlFor="sku" className={labelClass}>
            SKU <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="sku"
            value={sku}
            onChange={(e) => setSku(e.target.value)}
            placeholder="e.g. PAN-540-MONO"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="rack" className={labelClass}>
            Rack location{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="rack"
            value={rackLocation}
            onChange={(e) => setRackLocation(e.target.value)}
            placeholder="e.g. Rack A-3"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="reorder" className={labelClass}>
            Reorder threshold{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="reorder"
            type="number"
            min="0"
            step="any"
            value={reorderThreshold}
            onChange={(e) => setReorderThreshold(e.target.value)}
            placeholder="Flag as low stock at or below…"
            className={inputClass}
          />
        </div>
      </div>

      <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
        Opening stock is not set here. Add the item, then log a <strong>Stock In</strong> movement
        to record the quantity received — every quantity change flows through the movement log so
        the count can never drift.
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
          {pending ? 'Adding…' : 'Add item'}
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
