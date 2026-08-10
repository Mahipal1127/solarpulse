'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

/**
 * Mirrors createSalesTargetSchema, including its period-order rule. The server
 * re-checks all of it — assertCanSetTargets() is what actually decides whether a
 * caller may write a target, and the sales_targets policies deny an executive's
 * insert outright.
 */
const schema = z
  .object({
    user_id: z.string().min(1, 'Select an employee'),
    period_start: z.string().min(1, 'Pick a start date'),
    period_end: z.string().min(1, 'Pick an end date'),
    target_amount: z.string().min(1, 'Enter the target amount'),
    target_deals: z.string().optional(),
  })
  .refine((v) => new Date(v.period_end) >= new Date(v.period_start), {
    message: 'Period end must be on or after period start',
    path: ['period_end'],
  })

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function TargetForm({
  employees,
}: {
  employees: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) })

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const res = await fetch('/api/targets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: values.user_id,
        // Both are date columns, so the input's YYYY-MM-DD goes straight through.
        period_start: values.period_start,
        period_end: values.period_end,
        target_amount: Number(values.target_amount),
        target_deals: values.target_deals ? Number(values.target_deals) : null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the target.')
      return
    }

    reset()
    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-brand-gold px-3.5 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
      >
        + Set target
      </button>
    )
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="w-full space-y-3 rounded-lg border border-border-subtle bg-surface-bg p-4"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <label htmlFor="t-user" className={labelClass}>
            Employee
          </label>
          <select id="t-user" {...register('user_id')} className={inputClass}>
            <option value="">Select…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          {errors.user_id && (
            <p className="mt-1 text-xs text-status-danger">{errors.user_id.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="t-start" className={labelClass}>
            Period Start
          </label>
          <input id="t-start" type="date" {...register('period_start')} className={inputClass} />
          {errors.period_start && (
            <p className="mt-1 text-xs text-status-danger">{errors.period_start.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="t-end" className={labelClass}>
            Period End
          </label>
          <input id="t-end" type="date" {...register('period_end')} className={inputClass} />
          {errors.period_end && (
            <p className="mt-1 text-xs text-status-danger">{errors.period_end.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="t-amount" className={labelClass}>
            Target (₹)
          </label>
          <input
            id="t-amount"
            type="number"
            min={0}
            step="0.01"
            {...register('target_amount')}
            className={inputClass}
          />
          {errors.target_amount && (
            <p className="mt-1 text-xs text-status-danger">{errors.target_amount.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="t-deals" className={labelClass}>
            Target Deals{' '}
            <span className="font-normal normal-case text-text-muted/60">(optional)</span>
          </label>
          <input
            id="t-deals"
            type="number"
            min={1}
            step="1"
            {...register('target_deals')}
            className={inputClass}
          />
        </div>
      </div>

      {serverError && <p className="text-xs text-status-danger">⚠ {serverError}</p>}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {isSubmitting ? 'Saving…' : 'Set target'}
        </button>
        <button
          type="button"
          onClick={() => {
            reset()
            setOpen(false)
          }}
          className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>
    </form>
  )
}
