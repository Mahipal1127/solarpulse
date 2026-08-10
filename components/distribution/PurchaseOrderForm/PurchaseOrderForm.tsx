'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Trash2, Plus } from 'lucide-react'
import { formatCurrency, MATERIAL_CATEGORY_LABELS } from '@/lib/format'
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  DEFAULT_MATERIAL_UNIT,
} from '@/lib/distribution/constants'
import type { Vendor, PurchaseOrder, PurchaseOrderItem } from '@/lib/types'

/**
 * Mirrors createPurchaseOrderSchema in browser-native form values: numbers are
 * held as strings and converted at submit, matching LeadForm.
 *
 * total_amount is deliberately not a field. It is derived in the database by the
 * recompute_po_total() trigger from the line items, so there is nothing here for a
 * user to type and nothing for the client to send — the running total below is
 * display only.
 */
const lineItemSchema = z.object({
  item_name: z.string().trim().min(1, 'Required').max(300),
  category: z.string().optional(),
  quantity: z
    .string()
    .min(1, 'Required')
    .refine((v) => Number(v) > 0, 'Must be greater than zero'),
  unit: z.string().min(1),
  unit_price: z
    .string()
    .min(1, 'Required')
    .refine((v) => Number(v) >= 0, 'Cannot be negative'),
})

const schema = z.object({
  vendor_id: z.string().min(1, 'Select a vendor'),
  expected_delivery_date: z.string().optional(),
  notes: z.string().trim().max(5000).optional(),
  items: z.array(lineItemSchema).min(1, 'Add at least one line item'),
})

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const cellClass =
  'w-full rounded-lg border border-border-subtle px-2.5 py-2 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

const EMPTY_ITEM = {
  item_name: '',
  category: '',
  quantity: '',
  unit: DEFAULT_MATERIAL_UNIT,
  unit_price: '',
}

export function PurchaseOrderForm({
  mode,
  vendors,
  purchaseOrder,
  items,
}: {
  mode: 'create' | 'edit'
  /** Active vendors only — a deactivated supplier should not take new orders. */
  vendors: Pick<Vendor, 'id' | 'name' | 'category'>[]
  purchaseOrder?: PurchaseOrder
  items?: PurchaseOrderItem[]
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  /**
   * Line items and the vendor are frozen once the PO leaves 'draft'. Finance
   * approves a specific amount from a specific supplier, so letting either move
   * afterwards would shift what they signed off. The service layer refuses it
   * either way; this keeps the inputs honest about it.
   */
  const termsLocked = mode === 'edit' && purchaseOrder?.status !== 'draft'

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues:
      purchaseOrder && items
        ? {
            vendor_id: purchaseOrder.vendor_id,
            expected_delivery_date: purchaseOrder.expected_delivery_date ?? '',
            notes: purchaseOrder.notes ?? '',
            items: items.map((item) => ({
              item_name: item.item_name,
              category: item.category ?? '',
              quantity: String(Number(item.quantity)),
              unit: item.unit,
              unit_price: String(Number(item.unit_price)),
            })),
          }
        : { items: [{ ...EMPTY_ITEM }] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  // Recomputed on every keystroke so the person raising the order sees what
  // Finance will be asked to approve. The database recomputes it independently on
  // save; if the two ever disagree, the database is right.
  const watchedItems = watch('items') ?? []
  const runningTotal = watchedItems.reduce(
    (sum, item) => sum + (Number(item?.quantity) || 0) * (Number(item?.unit_price) || 0),
    0
  )

  async function submit(values: FormValues, submitForApproval: boolean) {
    setServerError(null)

    const payload: Record<string, unknown> = {
      vendor_id: values.vendor_id,
      expected_delivery_date: values.expected_delivery_date || null,
      notes: values.notes || null,
    }

    // Sending items on a non-draft PO would be refused; leaving them out lets an
    // approved order still have its delivery date and notes corrected.
    if (!termsLocked) {
      payload.items = values.items.map((item) => ({
        item_name: item.item_name,
        category: item.category || null,
        quantity: Number(item.quantity),
        unit: item.unit,
        unit_price: Number(item.unit_price),
      }))
    }

    if (mode === 'create') payload.submit_for_approval = submitForApproval

    const res = await fetch(
      mode === 'create' ? '/api/purchase-orders' : `/api/purchase-orders/${purchaseOrder!.id}`,
      {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the purchase order.')
      return
    }

    router.push(`/distribution/purchase-orders/${body.purchaseOrder.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit((v) => submit(v, false))} className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="vendor_id" className={labelClass}>
            Vendor <span className="text-status-danger">*</span>
          </label>
          <select
            id="vendor_id"
            {...register('vendor_id')}
            disabled={termsLocked}
            className={`${inputClass} disabled:bg-surface-bg disabled:text-text-muted`}
          >
            <option value="">Select a vendor</option>
            {vendors.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
                {v.category ? ` — ${MATERIAL_CATEGORY_LABELS[v.category] ?? v.category}` : ''}
              </option>
            ))}
          </select>
          {errors.vendor_id && (
            <p className="mt-1 text-xs text-status-danger">{errors.vendor_id.message}</p>
          )}
          {vendors.length === 0 && (
            <p className="mt-1 text-xs text-status-warning">
              No active vendors yet — add one before raising an order.
            </p>
          )}
        </div>

        <div>
          <label htmlFor="expected_delivery_date" className={labelClass}>
            Expected Delivery
          </label>
          <input
            id="expected_delivery_date"
            type="date"
            {...register('expected_delivery_date')}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-text-muted">
            Orders past this date are flagged as overdue until received.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-brand-slate">Line items</h3>
          {!termsLocked && (
            <button
              type="button"
              onClick={() => append({ ...EMPTY_ITEM })}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
            >
              <Plus className="h-3.5 w-3.5" />
              Add item
            </button>
          )}
        </div>

        {termsLocked && (
          <p className="mt-2 rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
            Line items are locked once an order leaves draft — Finance approves a specific amount, so
            the lines behind it cannot move afterwards.
          </p>
        )}

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <Th className="min-w-48">Item</Th>
                <Th className="min-w-32">Category</Th>
                <Th className="w-24">Qty</Th>
                <Th className="w-24">Unit</Th>
                <Th className="w-32">Unit Price</Th>
                <Th className="w-28 text-right">Line Total</Th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => {
                const row = watchedItems[index]
                const lineTotal = (Number(row?.quantity) || 0) * (Number(row?.unit_price) || 0)

                return (
                  <tr key={field.id} className="align-top">
                    <td className="py-1.5 pr-2">
                      <input
                        {...register(`items.${index}.item_name`)}
                        disabled={termsLocked}
                        placeholder="540W mono panel"
                        aria-label={`Item ${index + 1} name`}
                        className={`${cellClass} disabled:bg-surface-bg`}
                      />
                      {errors.items?.[index]?.item_name && (
                        <p className="mt-1 text-xs text-status-danger">
                          {errors.items[index]?.item_name?.message}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        {...register(`items.${index}.category`)}
                        disabled={termsLocked}
                        aria-label={`Item ${index + 1} category`}
                        className={`${cellClass} disabled:bg-surface-bg`}
                      >
                        <option value="">—</option>
                        {MATERIAL_CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {MATERIAL_CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        {...register(`items.${index}.quantity`)}
                        disabled={termsLocked}
                        aria-label={`Item ${index + 1} quantity`}
                        className={`${cellClass} disabled:bg-surface-bg`}
                      />
                      {errors.items?.[index]?.quantity && (
                        <p className="mt-1 text-xs text-status-danger">
                          {errors.items[index]?.quantity?.message}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 pr-2">
                      <select
                        {...register(`items.${index}.unit`)}
                        disabled={termsLocked}
                        aria-label={`Item ${index + 1} unit`}
                        className={`${cellClass} disabled:bg-surface-bg`}
                      >
                        {MATERIAL_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        {...register(`items.${index}.unit_price`)}
                        disabled={termsLocked}
                        aria-label={`Item ${index + 1} unit price`}
                        className={`${cellClass} disabled:bg-surface-bg`}
                      />
                      {errors.items?.[index]?.unit_price && (
                        <p className="mt-1 text-xs text-status-danger">
                          {errors.items[index]?.unit_price?.message}
                        </p>
                      )}
                    </td>
                    <td className="py-1.5 pr-2 pt-4 text-right text-sm font-medium text-brand-slate">
                      {formatCurrency(lineTotal)}
                    </td>
                    <td className="py-1.5 pt-3">
                      {!termsLocked && fields.length > 1 && (
                        <button
                          type="button"
                          onClick={() => remove(index)}
                          aria-label={`Remove item ${index + 1}`}
                          className="rounded-lg p-1.5 text-text-muted/60 transition-colors hover:bg-status-danger/5 hover:text-status-danger"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {errors.items?.root && (
          <p className="mt-2 text-xs text-status-danger">{errors.items.root.message}</p>
        )}

        <div className="mt-4 flex items-baseline justify-end gap-3 border-t border-border-subtle pt-4">
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Order total
          </span>
          <span className="text-xl font-semibold text-brand-slate">
            {formatCurrency(runningTotal)}
          </span>
        </div>
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          {...register('notes')}
          placeholder="Delivery instructions, payment terms agreed with the vendor."
          className={inputClass}
        />
      </div>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {serverError}</p>
      )}

      <div className="flex flex-wrap items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg border border-border-subtle px-5 py-2.5 text-sm font-semibold text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Save as draft' : 'Save changes'}
        </button>

        {/**
         * Submitting for approval is offered at creation because it is the common
         * path — most orders are raised to be approved, not parked. It only moves
         * the PO to 'pending_finance_approval'; reaching 'approved' is Finance's
         * action on the detail page, and no button here can shortcut to it.
         */}
        {mode === 'create' && (
          <button
            type="button"
            disabled={isSubmitting}
            onClick={handleSubmit((v) => submit(v, true))}
            className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
          >
            {isSubmitting ? 'Submitting…' : 'Submit for Finance approval'}
          </button>
        )}

        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

function Th({ children, className = '' }: { children?: React.ReactNode; className?: string }) {
  return (
    <th
      className={`pb-1.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted ${className}`}
    >
      {children}
    </th>
  )
}
