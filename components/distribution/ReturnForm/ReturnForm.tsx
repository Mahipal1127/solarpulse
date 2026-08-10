'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { MATERIAL_CATEGORY_LABELS, MATERIAL_CONDITION_LABELS, RETURN_REASON_LABELS } from '@/lib/format'
import {
  MATERIAL_CATEGORIES,
  MATERIAL_UNITS,
  RETURN_REASONS,
  DEFAULT_MATERIAL_UNIT,
} from '@/lib/distribution/constants'
import type { MaterialCondition } from '@/lib/types'

export type ReturnableDispatch = {
  id: string
  dispatch_number: string
  lead_id: string | null
  lead: { name: string } | null
  items: { item_name: string; category: string | null; unit: string }[]
}

/**
 * Logs material coming back from site. Mirrors createReturnSchema.
 *
 * There is no lead field: when a dispatch is named, the service takes the project
 * from that dispatch rather than from the request body, so a return cannot be
 * filed against the wrong project. A standalone return simply has no project.
 */
const schema = z.object({
  dispatch_id: z.string().optional(),
  item_name: z.string().trim().min(1, 'Item name is required').max(300),
  category: z.string().optional(),
  quantity: z
    .string()
    .min(1, 'Required')
    .refine((v) => Number(v) > 0, 'Must be greater than zero'),
  unit: z.string().min(1),
  reason: z.string().optional(),
  condition: z.enum(['good', 'damaged', 'unusable']),
})

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function ReturnForm({
  dispatches,
  initialDispatchId,
}: {
  /** Delivered dispatches — material has to have gone out before it can come back. */
  dispatches: ReturnableDispatch[]
  initialDispatchId?: string
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      dispatch_id: initialDispatchId ?? '',
      item_name: '',
      category: '',
      quantity: '',
      unit: DEFAULT_MATERIAL_UNIT,
      reason: '',
      condition: 'good',
    },
  })

  const dispatchId = watch('dispatch_id')
  const condition = watch('condition')

  const selected = useMemo(
    () => dispatches.find((d) => d.id === dispatchId) ?? null,
    [dispatches, dispatchId]
  )

  /**
   * Prefills from a line on the chosen dispatch. Item name stays free text
   * afterwards — a return is often a partial quantity, or an item that went out
   * under a slightly different description — but typing it again from scratch
   * invites a mismatch that makes the two records hard to tie together.
   */
  function prefillFromItem(itemName: string) {
    const item = selected?.items.find((i) => i.item_name === itemName)
    if (!item) return
    setValue('item_name', item.item_name, { shouldValidate: true })
    setValue('category', item.category ?? '')
    setValue('unit', item.unit)
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const res = await fetch('/api/returns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dispatch_id: values.dispatch_id || null,
        item_name: values.item_name,
        category: values.category || null,
        quantity: Number(values.quantity),
        unit: values.unit,
        reason: values.reason || null,
        condition: values.condition,
      }),
    })

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not log the return.')
      return
    }

    router.push('/distribution/returns')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label htmlFor="dispatch_id" className={labelClass}>
          Came back from
        </label>
        <select id="dispatch_id" {...register('dispatch_id')} className={inputClass}>
          <option value="">Not linked to a dispatch</option>
          {dispatches.map((d) => (
            <option key={d.id} value={d.id}>
              {d.dispatch_number}
              {d.lead ? ` — ${d.lead.name}` : ' — internal transfer'}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-text-muted">
          {selected
            ? 'The project is taken from this dispatch, so the return cannot land on the wrong job.'
            : 'Linking a dispatch ties the return to its project automatically.'}
        </p>
      </div>

      {selected && selected.items.length > 0 && (
        <div>
          <label htmlFor="prefill" className={labelClass}>
            Prefill from what was sent
          </label>
          <select
            id="prefill"
            defaultValue=""
            onChange={(e) => prefillFromItem(e.target.value)}
            className={inputClass}
          >
            <option value="">Choose an item…</option>
            {selected.items.map((item, index) => (
              <option key={`${item.item_name}-${index}`} value={item.item_name}>
                {item.item_name}
              </option>
            ))}
          </select>
        </div>
      )}

      <div>
        <label htmlFor="item_name" className={labelClass}>
          Item <span className="text-status-danger">*</span>
        </label>
        <input id="item_name" {...register('item_name')} className={inputClass} />
        {errors.item_name && (
          <p className="mt-1 text-xs text-status-danger">{errors.item_name.message}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
        <div>
          <label htmlFor="quantity" className={labelClass}>
            Quantity <span className="text-status-danger">*</span>
          </label>
          <input
            id="quantity"
            type="number"
            min={0}
            step="0.01"
            {...register('quantity')}
            className={inputClass}
          />
          {errors.quantity && (
            <p className="mt-1 text-xs text-status-danger">{errors.quantity.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="unit" className={labelClass}>
            Unit
          </label>
          <select id="unit" {...register('unit')} className={inputClass}>
            {MATERIAL_UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="category" className={labelClass}>
            Category
          </label>
          <select id="category" {...register('category')} className={inputClass}>
            <option value="">Not recorded</option>
            {MATERIAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {MATERIAL_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="reason" className={labelClass}>
            Why it came back
          </label>
          <select id="reason" {...register('reason')} className={inputClass}>
            <option value="">Not recorded</option>
            {RETURN_REASONS.map((r) => (
              <option key={r} value={r}>
                {RETURN_REASON_LABELS[r]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="condition" className={labelClass}>
            Condition <span className="text-status-danger">*</span>
          </label>
          <select id="condition" {...register('condition')} className={inputClass}>
            {(Object.keys(MATERIAL_CONDITION_LABELS) as MaterialCondition[]).map((c) => (
              <option key={c} value={c}>
                {MATERIAL_CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
          {condition === 'unusable' && (
            <p className="mt-1 text-xs text-status-warning">
              Unusable material still gets logged — Store decides what happens to it.
            </p>
          )}
        </div>
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
          {isSubmitting ? 'Logging…' : 'Log return'}
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
        Returns start as <strong>Pending</strong> until the material is checked in.
      </p>
    </form>
  )
}
