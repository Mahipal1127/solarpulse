'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Trash2, Plus } from 'lucide-react'
import { BOQ_UNITS, DEFAULT_BOQ_UNIT } from '@/lib/technical/constants'
import type { Design } from '@/lib/types'

/**
 * Mirrors createDesignSchema / updateDesignSchema in browser-native form values:
 * numbers held as strings and converted at submit, matching every other form in the
 * app. An empty numeric input yields '' and coercing that eagerly gives NaN, which
 * the server rejects with a complaint about a number the engineer never typed.
 *
 * No .default() anywhere. A default makes a field optional on the way *in* while it
 * stays required on the way out, and zodResolver types itself from the input side —
 * the two halves then stop agreeing with FormValues.
 *
 * status is deliberately absent: DesignStatusTracker owns it, so DESIGN_TRANSITIONS
 * is consulted in exactly one place.
 */
const boqLineSchema = z.object({
  item: z.string().trim().min(1, 'Required').max(300),
  qty: z
    .string()
    .min(1, 'Required')
    .refine((v) => Number(v) > 0, 'Must be greater than zero'),
  unit: z.string().min(1),
})

const schema = z.object({
  system_size_kw: z.string(),
  panel_count: z.string(),
  panel_wattage: z.string(),
  inverter_spec: z.string().trim().max(1000).optional(),
  boq_data: z.array(boqLineSchema),
})

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const cellClass =
  'w-full rounded-lg border border-border-subtle px-2.5 py-2 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

const EMPTY_LINE = { item: '', qty: '', unit: DEFAULT_BOQ_UNIT }

/** '' for a blank input, a number otherwise. Never NaN. */
function numberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

export function DesignForm({
  mode,
  /** Required when creating: a design is always drawn from a completed survey. */
  surveyId,
  design,
}: {
  mode: 'create' | 'edit'
  surveyId?: string
  design?: Design
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
    defaultValues: design
      ? {
          system_size_kw: design.system_size_kw?.toString() ?? '',
          panel_count: design.panel_count?.toString() ?? '',
          panel_wattage: design.panel_wattage?.toString() ?? '',
          inverter_spec: design.inverter_spec ?? '',
          boq_data: (design.boq_data ?? []).map((line) => ({
            item: line.item,
            qty: String(Number(line.qty)),
            unit: line.unit,
          })),
        }
      : {
          system_size_kw: '',
          panel_count: '',
          panel_wattage: '',
          inverter_spec: '',
          boq_data: [],
        },
  })

  const { fields, append, remove } = useFieldArray({ control, name: 'boq_data' })

  /**
   * Panels × wattage, offered as a suggestion rather than written into the field.
   *
   * Plain arithmetic on two numbers the engineer typed — not a generation estimate.
   * Yield modelling needs irradiance data, shading geometry and system losses, and
   * this system deliberately does not compute those; see GenerationReportForm.
   *
   * Not auto-filled because DC panel capacity and the figure an engineer records as
   * system size are not always the same number, and silently overwriting theirs
   * would be presenting our arithmetic as their engineering.
   */
  const panelCount = Number(watch('panel_count'))
  const panelWattage = Number(watch('panel_wattage'))
  const currentSize = watch('system_size_kw')
  const derivedSize =
    Number.isFinite(panelCount) && panelCount > 0 && Number.isFinite(panelWattage) && panelWattage > 0
      ? (panelCount * panelWattage) / 1000
      : null
  const showSuggestion =
    derivedSize !== null && Math.abs(Number(currentSize) - derivedSize) > 0.005

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const lines = values.boq_data.map((line) => ({
      item: line.item,
      qty: Number(line.qty),
      unit: line.unit,
    }))

    const payload = {
      system_size_kw: numberOrNull(values.system_size_kw),
      panel_count: numberOrNull(values.panel_count),
      panel_wattage: numberOrNull(values.panel_wattage),
      inverter_spec: values.inverter_spec || null,
      // null rather than [] when the engineer has not written a BOQ yet: the column
      // is nullable precisely to distinguish "no bill of quantities" from "a bill of
      // quantities with nothing on it".
      boq_data: lines.length > 0 ? lines : null,
    }

    const res = await fetch(
      mode === 'create' ? `/api/surveys/${surveyId}/designs` : `/api/designs/${design!.id}`,
      {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the design.')
      return
    }

    router.push(`/technical/designs/${body.design.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <section className="space-y-5">
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div>
            <label htmlFor="panel_count" className={labelClass}>
              Panel count
            </label>
            <input
              id="panel_count"
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              {...register('panel_count')}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="panel_wattage" className={labelClass}>
              Panel wattage (W)
            </label>
            <input
              id="panel_wattage"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              placeholder="550"
              {...register('panel_wattage')}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="system_size_kw" className={labelClass}>
              System size (kW)
            </label>
            <input
              id="system_size_kw"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              {...register('system_size_kw')}
              className={inputClass}
            />
            {showSuggestion && (
              <p className="mt-1 text-xs text-text-muted">
                {panelCount} × {panelWattage} W is {derivedSize.toFixed(2)} kW.{' '}
                <button
                  type="button"
                  onClick={() =>
                    setValue('system_size_kw', derivedSize.toFixed(2), { shouldValidate: true })
                  }
                  className="font-medium text-brand-slate underline hover:text-brand-slate"
                >
                  Use it
                </button>
              </p>
            )}
          </div>
        </div>

        <div>
          <label htmlFor="inverter_spec" className={labelClass}>
            Inverter specification
          </label>
          <textarea
            id="inverter_spec"
            rows={2}
            {...register('inverter_spec')}
            placeholder="Make, model, rating and phase — e.g. 10 kW three-phase string inverter."
            className={inputClass}
          />
          {errors.inverter_spec && (
            <p className="mt-1 text-xs text-status-danger">{errors.inverter_spec.message}</p>
          )}
        </div>
      </section>

      <section className="space-y-3 border-t border-border-subtle pt-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold text-brand-slate">Bill of quantities</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              What this system needs. No prices and no stock levels — costing is Sales&apos; and
              inventory is Store&apos;s, and a second copy of either here would be one more thing to
              keep in step.
            </p>
          </div>
          <button
            type="button"
            onClick={() => append({ ...EMPTY_LINE })}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
          >
            <Plus className="h-3.5 w-3.5" />
            Add line
          </button>
        </div>

        {fields.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-subtle bg-surface-bg px-4 py-6 text-center text-xs text-text-muted">
            No lines yet. A design can be saved without a BOQ and have one added later.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left">
              <thead>
                <tr className="border-b border-border-subtle">
                  <th className="pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Item
                  </th>
                  <th className="w-28 pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Qty
                  </th>
                  <th className="w-32 pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Unit
                  </th>
                  <th className="w-12 pb-2" />
                </tr>
              </thead>
              <tbody>
                {fields.map((field, index) => (
                  <tr key={field.id} className="border-b border-border-subtle last:border-0">
                    <td className="py-2 pr-2">
                      <input
                        {...register(`boq_data.${index}.item`)}
                        placeholder="550 W monocrystalline panel"
                        aria-label={`Item ${index + 1}`}
                        className={cellClass}
                      />
                      {errors.boq_data?.[index]?.item && (
                        <p className="mt-1 text-xs text-status-danger">
                          {errors.boq_data[index]?.item?.message}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <input
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        {...register(`boq_data.${index}.qty`)}
                        aria-label={`Quantity ${index + 1}`}
                        className={cellClass}
                      />
                      {errors.boq_data?.[index]?.qty && (
                        <p className="mt-1 text-xs text-status-danger">
                          {errors.boq_data[index]?.qty?.message}
                        </p>
                      )}
                    </td>
                    <td className="py-2 pr-2">
                      <select
                        {...register(`boq_data.${index}.unit`)}
                        aria-label={`Unit ${index + 1}`}
                        className={cellClass}
                      >
                        {BOQ_UNITS.map((unit) => (
                          <option key={unit} value={unit}>
                            {unit}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={`Remove line ${index + 1}`}
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
      </section>

      {serverError && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {serverError}</p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Start design' : 'Save changes'}
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
