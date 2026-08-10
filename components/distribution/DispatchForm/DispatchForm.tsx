'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Trash2, Plus, PackageCheck } from 'lucide-react'
import { formatQuantity, MATERIAL_CATEGORY_LABELS } from '@/lib/format'
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  DEFAULT_MATERIAL_UNIT,
} from '@/lib/distribution/constants'
import type { MaterialAllocation } from '@/lib/types'

/**
 * Mirrors createDispatchSchema, including both of its cross-field rules: a
 * dispatch needs either allocations or ad-hoc items, and one drawn from
 * allocations needs the project they belong to.
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

const schema = z
  .object({
    lead_id: z.string().optional(),
    /**
     * Both arrays are plainly required, with no .default([]) — unlike the server
     * schema, which needs one because a JSON body may omit the key entirely.
     * A default would make these optional on the way *in* while staying required on
     * the way out, and zodResolver types itself from the input side: the two halves
     * would no longer agree with FormValues. defaultValues below supplies [] for
     * both, so there is nothing for a default to do here anyway.
     */
    allocation_ids: z.array(z.string()),
    items: z.array(itemSchema),
    vehicle_details: z.string().trim().max(300).optional(),
    driver_contact: z
      .string()
      .trim()
      .max(20)
      .regex(/^[+\d\s()-]*$/, 'Phone may only contain digits, spaces, and + ( ) -')
      .optional(),
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.allocation_ids.length > 0 || v.items.length > 0, {
    message: 'Select at least one allocation or add an item',
    path: ['items'],
  })
  .refine((v) => v.allocation_ids.length === 0 || Boolean(v.lead_id), {
    message: 'Choose the project these allocations belong to',
    path: ['lead_id'],
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

export function DispatchForm({
  projects,
  /** Unfulfilled allocations only — anything already dispatched cannot be sent twice. */
  allocations,
  initialLeadId,
}: {
  projects: { id: string; name: string }[]
  allocations: (MaterialAllocation & { lead: { id: string; name: string } | null })[]
  /** Arrives from the allocation board's "Dispatch material" link. */
  initialLeadId?: string
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      lead_id: initialLeadId ?? '',
      allocation_ids: [],
      items: [],
      vehicle_details: '',
      driver_contact: '',
      notes: '',
    },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'items' })

  const leadId = watch('lead_id')
  const selectedIds = watch('allocation_ids') ?? []

  // Only the chosen project's allocations are offerable: the database refuses a
  // dispatch mixing allocations from different projects, since the plan record
  // would stop meaning anything.
  const availableAllocations = useMemo(
    () => (leadId ? allocations.filter((a) => a.lead_id === leadId) : []),
    [allocations, leadId]
  )

  function toggleAllocation(id: string) {
    const next = selectedIds.includes(id)
      ? selectedIds.filter((existing) => existing !== id)
      : [...selectedIds, id]
    setValue('allocation_ids', next, { shouldValidate: true })
  }

  function changeProject(nextLeadId: string) {
    setValue('lead_id', nextLeadId)
    // Selections from the previous project would be rejected server-side, so they
    // are dropped here rather than carried into an error.
    setValue('allocation_ids', [], { shouldValidate: true })
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)

    /**
     * One request. create_dispatch_from_allocations() writes the dispatch, copies
     * the chosen allocations into dispatch items, and flips those allocations to
     * 'dispatched' with linked_dispatch_id set — all in one transaction.
     *
     * Deliberately not a create-then-update pair from here: a failure between the
     * two would either send the same material twice or mark allocations against a
     * dispatch that was never created.
     */
    const res = await fetch('/api/dispatches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: values.lead_id || null,
        allocation_ids: values.allocation_ids,
        items: values.items.map((item) => ({
          item_name: item.item_name,
          category: item.category || null,
          quantity: Number(item.quantity),
          unit: item.unit,
        })),
        vehicle_details: values.vehicle_details || null,
        driver_contact: values.driver_contact || null,
        notes: values.notes || null,
      }),
    })

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not create the dispatch.')
      return
    }

    router.push(`/distribution/dispatches/${body.dispatch.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="lead_id" className={labelClass}>
            Project
          </label>
          <select
            id="lead_id"
            value={leadId ?? ''}
            onChange={(e) => changeProject(e.target.value)}
            className={inputClass}
          >
            <option value="">No project — internal transfer</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {errors.lead_id && (
            <p className="mt-1 text-xs text-status-danger">{errors.lead_id.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="vehicle_details" className={labelClass}>
            Vehicle
          </label>
          <input
            id="vehicle_details"
            {...register('vehicle_details')}
            placeholder="MH 12 AB 3456 — Tata 407"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="driver_contact" className={labelClass}>
            Driver Contact
          </label>
          <input
            id="driver_contact"
            type="tel"
            {...register('driver_contact')}
            placeholder="+91 98765 43210"
            className={inputClass}
          />
          {errors.driver_contact && (
            <p className="mt-1 text-xs text-status-danger">{errors.driver_contact.message}</p>
          )}
        </div>
      </div>

      {/* Allocation picker. Fulfilling planned material is the normal path, so it
          comes before the ad-hoc lines. */}
      <div>
        <h3 className="text-sm font-semibold text-brand-slate">Fulfil planned allocations</h3>

        {!leadId ? (
          <p className="mt-2 rounded-lg bg-surface-bg px-3 py-2.5 text-xs text-text-muted">
            Choose a project to see what has been allocated to it.
          </p>
        ) : availableAllocations.length === 0 ? (
          <p className="mt-2 rounded-lg bg-surface-bg px-3 py-2.5 text-xs text-text-muted">
            Nothing awaiting dispatch on this project. Add items below to send material anyway.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-border-subtle overflow-hidden rounded-lg border border-border-subtle">
            {availableAllocations.map((allocation) => {
              const checked = selectedIds.includes(allocation.id)
              return (
                <li key={allocation.id}>
                  <label
                    className={`flex cursor-pointer items-center gap-3 px-4 py-3 transition-colors ${
                      checked ? 'bg-brand-gold/5' : 'hover:bg-surface-bg'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleAllocation(allocation.id)}
                      className="h-4 w-4 shrink-0 rounded border-border-subtle text-brand-slate "
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium text-brand-slate">
                        {allocation.item_name}
                      </span>
                      <span className="mt-0.5 block text-xs text-text-muted">
                        {formatQuantity(allocation.quantity, allocation.unit)}
                        {allocation.category
                          ? ` · ${MATERIAL_CATEGORY_LABELS[allocation.category] ?? allocation.category}`
                          : ''}
                      </span>
                    </span>
                    {checked && (
                      <PackageCheck className="h-4 w-4 shrink-0 text-brand-slate" />
                    )}
                  </label>
                </li>
              )
            })}
          </ul>
        )}

        {selectedIds.length > 0 && (
          <p className="mt-2 text-xs text-text-muted">
            {selectedIds.length} allocation{selectedIds.length === 1 ? '' : 's'} selected. Their
            items are copied onto this dispatch and marked dispatched when you save.
          </p>
        )}
      </div>

      {/* Ad-hoc lines, for material that was never planned as an allocation. */}
      <div>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-brand-slate">Additional items</h3>
            <p className="mt-0.5 text-xs text-text-muted">
              Material going out that was not allocated in advance.
            </p>
          </div>
          <button
            type="button"
            onClick={() => append({ ...EMPTY_ITEM })}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
          >
            <Plus className="h-3.5 w-3.5" />
            Add item
          </button>
        </div>

        {fields.length > 0 && (
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
                        placeholder="Mounting clamps"
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
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={`Remove item ${index + 1}`}
                        className="rounded-lg p-1.5 text-text-muted/60 transition-colors hover:bg-status-danger/5 hover:text-status-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Carries the "needs allocations or items" rule from the schema. */}
        {errors.items?.message && (
          <p className="mt-2 text-xs text-status-danger">{errors.items.message}</p>
        )}
        {errors.items?.root && (
          <p className="mt-2 text-xs text-status-danger">{errors.items.root.message}</p>
        )}
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Delivery Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          {...register('notes')}
          placeholder="Site contact, access instructions, unloading arrangements."
          className={inputClass}
        />
      </div>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {serverError}</p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {isSubmitting ? 'Creating…' : 'Create dispatch'}
        </button>
        <button
          type="button"
          onClick={() => router.back()}
          className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>

      <p className="text-xs text-text-muted">
        A dispatch starts as <strong>Preparing</strong>. Mark it in transit when it leaves — the
        departure time is stamped then, not now.
      </p>
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
