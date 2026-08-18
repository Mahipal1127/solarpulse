'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { STORE_MEDIA_BUCKET, MAX_UPLOAD_BYTES } from '@/lib/store/constants'
import type { InventoryItemOption } from '@/lib/store/dashboard'

/**
 * Records damaged stock. The quantity decrements the item and a damage-detail row (reason,
 * optional photo) is written in the SAME transaction server-side (record_damaged_stock). An
 * optional photo is pushed to the private store-media bucket first — its path must start with
 * the org id, which the storage policy (0017) reads back to authorise the write — then the
 * path is handed to the endpoint. If the record call fails after upload, the orphan object is
 * removed rather than left behind.
 */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'
const MAX_MB = Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))

export function DamagedStockForm({
  items,
  organizationId,
}: {
  items: InventoryItemOption[]
  organizationId: string
}) {
  const router = useRouter()
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [reason, setReason] = useState('')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = items.find((i) => i.id === itemId)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!itemId) {
      setError('Select an item.')
      return
    }
    const qty = Number(quantity)
    if (quantity === '' || Number.isNaN(qty) || qty <= 0) {
      setError('Enter a quantity greater than zero.')
      return
    }
    if (file && file.size > MAX_UPLOAD_BYTES) {
      setError(`That file is larger than ${MAX_MB} MB. Compress it or upload a smaller image.`)
      return
    }

    setPending(true)

    // Upload the photo first (if any). First path segment must be the org id: the storage
    // policy reads it back to decide whether this user may write here at all.
    let photoPath: string | null = null
    const supabase = createClient()
    if (file) {
      photoPath = `${organizationId}/${crypto.randomUUID()}-${file.name}`
      const { error: uploadError } = await supabase.storage
        .from(STORE_MEDIA_BUCKET)
        .upload(photoPath, file)
      if (uploadError) {
        setPending(false)
        setError(uploadError.message)
        return
      }
    }

    const res = await fetch('/api/stock-movements/damaged', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        inventory_item_id: itemId,
        quantity: qty,
        reason: reason.trim() || null,
        notes: notes.trim() || null,
        photo_file_path: photoPath,
      }),
    })

    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // The object landed but the record did not — remove the orphan.
      if (photoPath) await supabase.storage.from(STORE_MEDIA_BUCKET).remove([photoPath])
      setError(body.error ?? 'Could not record the damaged stock.')
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
          <label htmlFor="quantity" className={labelClass}>
            Damaged quantity {selected ? `(${selected.unit})` : ''}{' '}
            <span className="text-status-danger">*</span>
          </label>
          <input
            id="quantity"
            type="number"
            min="0"
            step="any"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="photo" className={labelClass}>
            Photo <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="photo"
            type="file"
            accept="image/*"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="mt-1 block w-full text-sm text-text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-surface-bg file:px-3 file:py-2 file:text-sm file:font-medium file:text-text-muted file:ring-1 file:ring-border-subtle"
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="reason" className={labelClass}>
            Reason <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Cracked in transit"
            className={inputClass}
          />
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

      <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
        This reduces the item&apos;s stock by the quantity entered and files the damage record in
        one step.
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
          {pending ? 'Recording…' : 'Record damaged stock'}
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
