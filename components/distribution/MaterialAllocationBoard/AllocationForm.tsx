'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Trash2, Plus } from 'lucide-react'
import { MATERIAL_CATEGORY_LABELS } from '@/lib/format'
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  DEFAULT_MATERIAL_UNIT,
} from '@/lib/distribution/constants'

/**
 * Plans material against a project — several items in one submission, since
 * allocation is something you do for a whole job rather than item by item.
 *
 * Mirrors createAllocationSchema, with quantities held as strings and converted at
 * submit like every other form in this codebase.
 */
const itemSchema = z.object({
  item_name: z.string().trim().min(1, 'Required').max(300),
  category: z.string().optional(),
  quantity: z
    .string()
    .min(1, 'Required')
    .refine((v) => Number(v) > 0, 'Must be greater than zero'),
  unit: z.string().min(1),
})

const schema = z.object({
  lead_id: z.string().min(1, 'Select a project'),
  items: z.array(itemSchema).min(1, 'Add at least one item'),
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
}

export function AllocationForm({
  projects,
  onDone,
}: {
  /** Closed-won leads. RLS shows Distribution nothing else, by design. */
  projects: { id: string; name: string }[]
  onDone?: () => void
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { items: [{ ...EMPTY_ITEM }] },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const res = await fetch('/api/allocations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: values.lead_id,
        items: values.items.map((item) => ({
          item_name: item.item_name,
          category: item.category || null,
          quantity: Number(item.quantity),
          unit: item.unit,
        })),
      }),
    })

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the allocation.')
      return
    }

    reset({ lead_id: values.lead_id, items: [{ ...EMPTY_ITEM }] })
    onDone?.()
    router.refresh()
  }

  if (projects.length === 0) {
    return (
      <p className="rounded-lg bg-surface-bg px-3 py-2.5 text-sm text-text-muted">
        No projects to allocate against yet. Material is planned against a closed-won lead, so one
        has to be won in Sales first.
      </p>
    )
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="max-w-md">
        <label htmlFor="lead_id" className={labelClass}>
          Project <span className="text-status-danger">*</span>
        </label>
        <select id="lead_id" {...register('lead_id')} className={inputClass}>
          <option value="">Select a project</option>
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {errors.lead_id && <p className="mt-1 text-xs text-status-danger">{errors.lead_id.message}</p>}
      </div>

      <div>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-brand-slate">Material</h3>
          <button
            type="button"
            onClick={() => append({ ...EMPTY_ITEM })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr>
                <Th className="min-w-48">Item</Th>
                <Th className="min-w-32">Category</Th>
                <Th className="w-24">Qty</Th>
                <Th className="w-24">Unit</Th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {fields.map((field, index) => (
                <tr key={field.id} className="align-top">
                  <td className="py-1.5 pr-2">
                    <input
                      {...register(`items.${index}.item_name`)}
                      placeholder="540W mono panel"
                      aria-label={`Item ${index + 1} name`}
                      className={cellClass}
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
                      aria-label={`Item ${index + 1} category`}
                      className={cellClass}
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
                      aria-label={`Item ${index + 1} quantity`}
                      className={cellClass}
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
                      aria-label={`Item ${index + 1} unit`}
                      className={cellClass}
                    >
                      {MATERIAL_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pt-3">
                    {fields.length > 1 && (
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
              ))}
            </tbody>
          </table>
        </div>

        {errors.items?.root && (
          <p className="mt-2 text-xs text-status-danger">{errors.items.root.message}</p>
        )}
      </div>

      {/* Said plainly, because "allocated" sounds like a stock reservation and is
          not one. Store owns the real inventory count and its module does not
          exist yet, so nothing here is checked against a live balance. */}
      <p className="rounded-lg bg-surface-bg px-3 py-2 text-xs text-text-muted">
        This is a plan, not a stock reservation — availability is not checked against warehouse
        stock. Store owns the inventory count.
      </p>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {serverError}</p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-4">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : 'Allocate material'}
        </button>
        {onDone && (
          <button
            type="button"
            onClick={onDone}
            className="rounded-lg px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
          >
            Cancel
          </button>
        )}
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
