'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { LEAD_SOURCES, LEAD_SOURCE_LABELS, PROPERTY_TYPE_LABELS } from '@/lib/format'
import type { Lead, PropertyType } from '@/lib/types'

/**
 * Mirrors createLeadSchema / updateLeadSchema in browser-native form values:
 * '' for an empty select or optional text, a string for the numeric field.
 * Conversion to null / Number happens at submit.
 *
 * Status is deliberately absent. Moving a lead through the pipeline has side
 * effects — a quotation advances it, closing it writes a customer row in the same
 * transaction — so stage changes live on the lead detail page's actions, not in a
 * free-form edit that could jump a lead to a stage with no supporting record.
 */
const schema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(200),
  phone: z
    .string()
    .trim()
    .max(20)
    .regex(/^[+\d\s()-]*$/, 'Phone may only contain digits, spaces, and + ( ) -')
    .optional(),
  email: z.union([z.literal(''), z.string().trim().email('Enter a valid email')]).optional(),
  source: z.string().optional(),
  property_type: z.string().optional(),
  estimated_load_kw: z.string().optional(),
  notes: z.string().trim().max(5000).optional(),
  assigned_to: z.string().optional(),
})

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function LeadForm({
  mode,
  lead,
  employees = [],
  canAssign = false,
}: {
  mode: 'create' | 'edit'
  lead?: Lead
  /** Sales roster. Only read when canAssign is true. */
  employees?: { id: string; full_name: string }[]
  /**
   * Sales Manager only. An executive's lead is always their own — the service
   * layer forces assigned_to to themselves and the RLS with-check rejects a row
   * that would end up owned by someone else, so hiding the field here is
   * cosmetic, not the actual control.
   */
  canAssign?: boolean
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: lead
      ? {
          name: lead.name,
          phone: lead.phone ?? '',
          email: lead.email ?? '',
          source: lead.source ?? '',
          property_type: lead.property_type ?? '',
          estimated_load_kw: lead.estimated_load_kw?.toString() ?? '',
          notes: lead.notes ?? '',
          assigned_to: lead.assigned_to ?? '',
        }
      : {},
  })

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const payload: Record<string, unknown> = {
      name: values.name,
      phone: values.phone || null,
      email: values.email || null,
      source: values.source || null,
      property_type: (values.property_type as PropertyType) || null,
      estimated_load_kw: values.estimated_load_kw ? Number(values.estimated_load_kw) : null,
      notes: values.notes || null,
    }

    // Only sent when the field was actually rendered — an executive's POST
    // carries no assigned_to at all, so the service assigns the lead to them.
    if (canAssign && values.assigned_to) payload.assigned_to = values.assigned_to

    const res = await fetch(mode === 'create' ? '/api/leads' : `/api/leads/${lead!.id}`, {
      method: mode === 'create' ? 'POST' : 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const body = await res.json()
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the lead.')
      return
    }

    router.push(`/sales/leads/${body.lead.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label htmlFor="name" className={labelClass}>
          Customer Name <span className="text-status-danger">*</span>
        </label>
        <input id="name" {...register('name')} className={inputClass} />
        {errors.name && <p className="mt-1 text-xs text-status-danger">{errors.name.message}</p>}
      </div>

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="phone" className={labelClass}>
            Phone
          </label>
          <input
            id="phone"
            type="tel"
            {...register('phone')}
            placeholder="+91 98765 43210"
            className={inputClass}
          />
          {errors.phone && <p className="mt-1 text-xs text-status-danger">{errors.phone.message}</p>}
        </div>

        <div>
          <label htmlFor="email" className={labelClass}>
            Email
          </label>
          <input id="email" type="email" {...register('email')} className={inputClass} />
          {errors.email && <p className="mt-1 text-xs text-status-danger">{errors.email.message}</p>}
        </div>

        <div>
          <label htmlFor="source" className={labelClass}>
            Source
          </label>
          <select id="source" {...register('source')} className={inputClass}>
            <option value="">Not recorded</option>
            {LEAD_SOURCES.map((s) => (
              <option key={s} value={s}>
                {LEAD_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="property_type" className={labelClass}>
            Property Type
          </label>
          <select id="property_type" {...register('property_type')} className={inputClass}>
            <option value="">Not recorded</option>
            {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map((p) => (
              <option key={p} value={p}>
                {PROPERTY_TYPE_LABELS[p]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="estimated_load_kw" className={labelClass}>
            Estimated Load{' '}
            <span className="font-normal normal-case text-text-muted/60">(kW, optional)</span>
          </label>
          <input
            id="estimated_load_kw"
            type="number"
            min={0}
            step="0.1"
            {...register('estimated_load_kw')}
            className={inputClass}
          />
        </div>

        {canAssign && (
          <div>
            <label htmlFor="assigned_to" className={labelClass}>
              Assigned To
            </label>
            <select id="assigned_to" {...register('assigned_to')} className={inputClass}>
              <option value="">{mode === 'create' ? 'Assign to me' : 'Keep current owner'}</option>
              {employees.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.full_name}
                </option>
              ))}
            </select>
            {employees.length === 0 && (
              <p className="mt-1 text-xs text-text-muted">
                No other active users in the Sales department yet.
              </p>
            )}
          </div>
        )}
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="notes"
          rows={4}
          {...register('notes')}
          placeholder="Site details, budget signals, what the customer asked for."
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
          {isSubmitting ? 'Saving…' : mode === 'create' ? 'Create lead' : 'Save changes'}
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
