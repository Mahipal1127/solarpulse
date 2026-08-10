'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Plane } from 'lucide-react'
import { formatDate } from '@/lib/format'

export interface EngineerOption {
  id: string
  full_name: string
}

export interface LeadOption {
  id: string
  name: string
}

/** A Sales request waiting to be picked up, with the lead's name resolved for display. */
export interface VisitRequestOption {
  id: string
  lead_id: string
  lead_name: string
  preferred_date: string | null
  notes: string | null
}

/**
 * Mirrors createSurveySchema and convertVisitRequestSchema in browser-native form
 * values: '' for an empty select or optional text, converted to null at submit.
 *
 * No .default() anywhere, unlike the server schemas. A default makes the field
 * optional on the way *in* while it stays required on the way out, and zodResolver
 * types itself from the input side — the two halves then stop agreeing with
 * FormValues. defaultValues below supplies every value, so there is nothing for a
 * default to do here.
 *
 * lead_id and site_visit_request_id are both loose strings rather than .uuid():
 * '' is the legitimate empty state for each, and requiring a uuid would make the
 * empty select fail validation before the submit handler can turn it into null.
 */
const schema = z.object({
  site_visit_request_id: z.string(),
  lead_id: z.string(),
  assigned_engineer_id: z.string().uuid('Assign an engineer'),
  scheduled_date: z.string(),
  notes: z.string().trim().max(5000).optional(),
  is_drone_survey: z.boolean(),
})

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function SurveyForm({
  engineers,
  leads,
  visitRequests,
  currentUserId,
  /** Preselected when arriving from a specific Sales request's "convert" button. */
  presetVisitRequestId,
}: {
  engineers: EngineerOption[]
  leads: LeadOption[]
  visitRequests: VisitRequestOption[]
  currentUserId: string
  presetVisitRequestId?: string
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      site_visit_request_id: presetVisitRequestId ?? '',
      lead_id: '',
      // Surveys are usually logged by whoever will run them. Still changeable —
      // a lead assigning work to their team is the other common case.
      assigned_engineer_id: currentUserId,
      scheduled_date: '',
      notes: '',
      is_drone_survey: false,
    },
  })

  const selectedRequestId = watch('site_visit_request_id')
  const converting = selectedRequestId !== ''
  const selectedRequest = visitRequests.find((r) => r.id === selectedRequestId)

  async function onSubmit(values: FormValues) {
    setServerError(null)

    /**
     * A datetime-local input yields '2026-08-09T14:30' — no zone — while the server
     * schema wants ISO 8601. Converting through Date interprets it in the browser's
     * zone, which is the surveyor's own, and that is the right reading of a time
     * someone typed while looking at their calendar.
     */
    const scheduled = values.scheduled_date
      ? new Date(values.scheduled_date).toISOString()
      : null

    /**
     * Two payload shapes for one endpoint, matching the two schemas behind it.
     * The conversion body deliberately omits lead_id: the RPC reads it from the
     * request server-side, so a hand-edited form cannot attach the survey to a
     * different customer's lead.
     */
    const payload = converting
      ? {
          site_visit_request_id: values.site_visit_request_id,
          assigned_engineer_id: values.assigned_engineer_id,
          scheduled_date: scheduled,
          notes: values.notes || null,
        }
      : {
          lead_id: values.lead_id || null,
          assigned_engineer_id: values.assigned_engineer_id,
          scheduled_date: scheduled,
          notes: values.notes || null,
          is_drone_survey: values.is_drone_survey,
        }

    const res = await fetch('/api/surveys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setServerError(body.error ?? 'Could not log the survey.')
      return
    }

    router.push(`/technical/surveys/${body.survey.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label htmlFor="site_visit_request_id" className={labelClass}>
          From a Sales site visit request
        </label>
        <select
          id="site_visit_request_id"
          {...register('site_visit_request_id')}
          disabled={presetVisitRequestId !== undefined}
          className={`${inputClass} disabled:bg-surface-bg disabled:text-text-muted`}
        >
          <option value="">Not from a request — logging this survey directly</option>
          {visitRequests.map((request) => (
            <option key={request.id} value={request.id}>
              {request.lead_name}
              {request.preferred_date ? ` · prefers ${formatDate(request.preferred_date)}` : ''}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-text-muted">
          {converting
            ? 'Picking this up marks the Sales request scheduled in the same transaction, so the two can never disagree about whether the work was accepted.'
            : 'Only requests nobody has picked up yet appear here. A request can become one survey.'}
        </p>
      </div>

      {converting ? (
        <div className="rounded-lg border border-status-info/25 bg-status-info/5 px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-status-info">Customer</p>
          <p className="mt-1 text-sm font-medium text-status-info">{selectedRequest?.lead_name}</p>
          {selectedRequest?.notes && (
            <p className="mt-1 text-xs text-status-info">
              Sales noted: {selectedRequest.notes}
            </p>
          )}
          <p className="mt-2 text-xs text-status-info">
            The lead comes from the request itself, not from this form.
          </p>
        </div>
      ) : (
        <div>
          <label htmlFor="lead_id" className={labelClass}>
            Lead
          </label>
          <select id="lead_id" {...register('lead_id')} className={inputClass}>
            <option value="">No lead linked</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-muted">
            Optional. A survey of a site with no lead behind it yet is legitimate.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="assigned_engineer_id" className={labelClass}>
            Assigned engineer <span className="text-status-danger">*</span>
          </label>
          <select
            id="assigned_engineer_id"
            {...register('assigned_engineer_id')}
            className={inputClass}
          >
            <option value="">Select an engineer</option>
            {engineers.map((engineer) => (
              <option key={engineer.id} value={engineer.id}>
                {engineer.full_name}
              </option>
            ))}
          </select>
          {errors.assigned_engineer_id && (
            <p className="mt-1 text-xs text-status-danger">{errors.assigned_engineer_id.message}</p>
          )}
        </div>

        <div>
          <label htmlFor="scheduled_date" className={labelClass}>
            Scheduled for
          </label>
          <input
            id="scheduled_date"
            type="datetime-local"
            {...register('scheduled_date')}
            className={inputClass}
          />
          <p className="mt-1 text-xs text-text-muted">
            {converting
              ? 'Leave blank if the date is not agreed yet — it will show as awaiting a date on the dashboard until it is set.'
              : 'Optional.'}
          </p>
        </div>
      </div>

      {!converting && (
        <label className="flex items-start gap-3 rounded-lg border border-border-subtle px-4 py-3">
          <input
            type="checkbox"
            {...register('is_drone_survey')}
            className="mt-0.5 h-4 w-4 rounded border-border-subtle text-brand-slate "
          />
          <span>
            <span className="flex items-center gap-1.5 text-sm font-medium text-brand-slate">
              <Plane className="h-3.5 w-3.5 text-text-muted/60" />
              Drone survey
            </span>
            {/* Stated plainly because the word "drone" invites the opposite
                assumption: this is a record that a drone was used, nothing more. */}
            <span className="mt-0.5 block text-xs text-text-muted">
              A record that aerial imagery was used. Nothing here flies or talks to a drone —
              aerial shots upload as ordinary survey photos.
            </span>
          </span>
        </label>
      )}

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="notes"
          rows={3}
          {...register('notes')}
          placeholder="Access arrangements, who to call on site, anything the engineer should know before going."
          className={inputClass}
        />
        {errors.notes && <p className="mt-1 text-xs text-status-danger">{errors.notes.message}</p>}
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
          {isSubmitting ? 'Saving…' : converting ? 'Accept and schedule' : 'Log survey'}
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
