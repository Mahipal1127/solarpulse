'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Tender } from '@/lib/types'

/**
 * Mirrors createTenderSchema / updateTenderSchema but works in browser-native
 * form values: a datetime-local string, '' for an empty select, a string for
 * the numeric field. Conversion happens at submit.
 *
 * The future-deadline rule only applies on create — a tender may be logged
 * retroactively, so edit accepts a past date.
 */
function buildSchema(mode: 'create' | 'edit') {
  return z.object({
    title: z.string().trim().min(3, 'Title must be at least 3 characters').max(300),
    issuing_authority: z.string().trim().max(300).optional(),
    tender_number: z.string().trim().max(120).optional(),
    description: z.string().trim().max(5000).optional(),
    submission_deadline: z
      .string()
      .min(1, 'Submission deadline is required')
      .refine(
        (v) => mode === 'edit' || new Date(v).getTime() > Date.now(),
        'Submission deadline must be in the future'
      ),
    estimated_value: z.string().optional(),
    assigned_employee_id: z.string().optional(),
  })
}

type FormValues = z.infer<ReturnType<typeof buildSchema>>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

/** '2026-08-07T14:30:00Z' -> '2026-08-07T20:00' in the browser's local zone. */
function toDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TenderForm({
  mode,
  tender,
  employees,
}: {
  mode: 'create' | 'edit'
  tender?: Tender
  employees: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(buildSchema(mode)),
    defaultValues: tender
      ? {
          title: tender.title,
          issuing_authority: tender.issuing_authority ?? '',
          tender_number: tender.tender_number ?? '',
          description: tender.description ?? '',
          submission_deadline: toDatetimeLocal(tender.submission_deadline),
          estimated_value: tender.estimated_value?.toString() ?? '',
          assigned_employee_id: tender.assigned_employee_id ?? '',
        }
      : {},
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const payload = {
      title: values.title,
      issuing_authority: values.issuing_authority || null,
      tender_number: values.tender_number || null,
      description: values.description || null,
      submission_deadline: new Date(values.submission_deadline).toISOString(),
      estimated_value: values.estimated_value ? Number(values.estimated_value) : null,
      assigned_employee_id: values.assigned_employee_id || null,
    }

    const res = await fetch(
      mode === 'create' ? '/api/tenders' : `/api/tenders/${tender!.id}`,
      {
        method: mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }
    )

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the tender.')
      return
    }

    router.push(`/tenders/${body.tender.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label htmlFor="title" className={labelClass}>
          Title <span className="text-status-danger">*</span>
        </label>
        <input id="title" {...register('title')} className={inputClass} />
        {errors.title && <p className="mt-1 text-xs text-status-danger">{errors.title.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="issuing_authority" className={labelClass}>
            Issuing Authority
          </label>
          <input
            id="issuing_authority"
            {...register('issuing_authority')}
            placeholder="e.g. MSEDCL, NTPC, SECI"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="tender_number" className={labelClass}>
            Tender Number
          </label>
          <input
            id="tender_number"
            {...register('tender_number')}
            placeholder="Official reference number"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="submission_deadline" className={labelClass}>
            Submission Deadline <span className="text-status-danger">*</span>
          </label>
          <input
            id="submission_deadline"
            type="datetime-local"
            {...register('submission_deadline')}
            className={inputClass}
          />
          {errors.submission_deadline && (
            <p className="mt-1 text-xs text-status-danger">{errors.submission_deadline.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="estimated_value" className={labelClass}>
            Estimated Value{' '}
            <span className="font-normal normal-case text-text-muted/60">(₹, optional)</span>
          </label>
          <input
            id="estimated_value"
            type="number"
            min={0}
            step="0.01"
            {...register('estimated_value')}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="assigned_employee_id" className={labelClass}>
            Assigned Employee
          </label>
          <select
            id="assigned_employee_id"
            {...register('assigned_employee_id')}
            className={inputClass}
          >
            <option value="">Unassigned</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          {employees.length === 0 && (
            <p className="mt-1 text-xs text-text-muted">
              No active users in the Tender department yet.
            </p>
          )}
        </div>
      </div>

      <div>
        <label htmlFor="description" className={labelClass}>
          Description
        </label>
        <textarea id="description" rows={5} {...register('description')} className={inputClass} />
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
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create tender' : 'Save changes'}
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
