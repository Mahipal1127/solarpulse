'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Crosshair, Plane } from 'lucide-react'
import { ROOF_ORIENTATIONS } from '@/lib/technical/constants'
import type { SiteSurvey } from '@/lib/types'
import type { EngineerOption } from './SurveyForm'

/**
 * The findings form: what the engineer measured on site.
 *
 * Separate from SurveyForm rather than a `mode` flag on it, because the two barely
 * overlap. Creating a survey is about who and when; editing one is about the roof,
 * the location and the bill. One component covering both would be mostly branches.
 *
 * Status is deliberately absent — SurveyStatusTracker owns it, so that the
 * transition table is consulted in exactly one place.
 *
 * Every numeric field is a string here and converted at submit, the same shape the
 * lead, tender and purchase order forms use: an empty numeric input yields '' and
 * coercing that eagerly gives NaN, which the server's positiveMeasure rejects with
 * a message about a number the user never typed.
 */
const schema = z
  .object({
    assigned_engineer_id: z.string().uuid('Assign an engineer'),
    scheduled_date: z.string(),
    usable_area_sqft: z.string(),
    tilt_degrees: z.string(),
    orientation: z.string(),
    shading_notes: z.string().trim().max(2000).optional(),
    gps_latitude: z.string(),
    gps_longitude: z.string(),
    electricity_bill_avg_units: z.string(),
    is_drone_survey: z.boolean(),
    notes: z.string().trim().max(5000).optional(),
  })
  /**
   * The same pair rule the server enforces, checked here so the engineer gets a
   * sentence instead of a 400. Half a coordinate is not a location — storing a lone
   * latitude would put the pin on the prime meridian.
   */
  .refine((v) => (v.gps_latitude.trim() === '') === (v.gps_longitude.trim() === ''), {
    message: 'Enter both latitude and longitude, or leave both blank',
    path: ['gps_latitude'],
  })
  .refine((v) => v.gps_latitude.trim() === '' || Math.abs(Number(v.gps_latitude)) <= 90, {
    message: 'Latitude must be between -90 and 90',
    path: ['gps_latitude'],
  })
  .refine((v) => v.gps_longitude.trim() === '' || Math.abs(Number(v.gps_longitude)) <= 180, {
    message: 'Longitude must be between -180 and 180',
    path: ['gps_longitude'],
  })

type FormValues = z.infer<typeof schema>

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

/** '' for a blank input, a number otherwise. Never NaN. */
function numberOrNull(value: string): number | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = Number(trimmed)
  return Number.isFinite(parsed) ? parsed : null
}

/** Renders a stored timestamp into the 'YYYY-MM-DDTHH:mm' a datetime-local wants, in local time. */
function toDateTimeLocal(value: string | null): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

export function SurveyEditForm({
  survey,
  engineers,
}: {
  survey: SiteSurvey
  engineers: EngineerOption[]
}) {
  const router = useRouter()
  const [serverError, setServerError] = useState<string | null>(null)
  const [locating, setLocating] = useState(false)
  const [locationNote, setLocationNote] = useState<string | null>(null)

  const roof = survey.roof_measurements

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      assigned_engineer_id: survey.assigned_engineer_id,
      scheduled_date: toDateTimeLocal(survey.scheduled_date),
      usable_area_sqft: roof?.usable_area_sqft?.toString() ?? '',
      tilt_degrees: roof?.tilt_degrees?.toString() ?? '',
      orientation: roof?.orientation ?? '',
      shading_notes: roof?.shading_notes ?? '',
      gps_latitude: survey.gps_latitude?.toString() ?? '',
      gps_longitude: survey.gps_longitude?.toString() ?? '',
      electricity_bill_avg_units: survey.electricity_bill_avg_units?.toString() ?? '',
      is_drone_survey: survey.is_drone_survey,
      notes: survey.notes ?? '',
    },
  })

  /**
   * Reads the device's location into the two coordinate fields.
   *
   * Fills the inputs rather than submitting: the engineer may be standing at the
   * gate rather than under the array, and a wrong pin is worse than a typed one.
   * Manual entry stays available for every failure mode — denied permission, no
   * sensor, a basement with no signal — so this is a convenience, never the only way
   * in. Requires a secure context, which is why an http:// preview shows the
   * unavailable message.
   */
  function captureLocation() {
    setLocationNote(null)

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationNote('This device cannot report its location. Type the coordinates instead.')
      return
    }

    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocating(false)
        // Six decimals is ~0.1 m, past the accuracy of any phone GPS. More digits
        // would imply a precision the reading does not have.
        setValue('gps_latitude', position.coords.latitude.toFixed(6), {
          shouldValidate: true,
        })
        setValue('gps_longitude', position.coords.longitude.toFixed(6), {
          shouldValidate: true,
        })
        setLocationNote(
          `Captured to about ${Math.round(position.coords.accuracy)} m. Check it against where you are standing before saving.`
        )
      },
      (error) => {
        setLocating(false)
        setLocationNote(
          error.code === error.PERMISSION_DENIED
            ? 'Location permission was denied. Type the coordinates instead.'
            : 'Could not get a location fix. Type the coordinates instead.'
        )
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    )
  }

  async function onSubmit(values: FormValues) {
    setServerError(null)

    const area = numberOrNull(values.usable_area_sqft)
    const tilt = numberOrNull(values.tilt_degrees)
    const orientation = values.orientation.trim()
    const shading = values.shading_notes?.trim() ?? ''

    /**
     * The jsonb blob is sent whole or as null — there is no partial update of a
     * single key inside it. All four empty means the engineer recorded no roof
     * details, and null says that more honestly than an object of empty strings.
     *
     * Undefined keys are dropped by JSON.stringify, which is what makes the
     * server's every-field-optional schema work: a survey with an area but no tilt
     * sends only the area.
     */
    const roofMeasurements =
      area === null && tilt === null && orientation === '' && shading === ''
        ? null
        : {
            usable_area_sqft: area ?? undefined,
            tilt_degrees: tilt ?? undefined,
            orientation: orientation || undefined,
            shading_notes: shading || undefined,
          }

    const payload = {
      assigned_engineer_id: values.assigned_engineer_id,
      scheduled_date: values.scheduled_date
        ? new Date(values.scheduled_date).toISOString()
        : null,
      roof_measurements: roofMeasurements,
      gps_latitude: numberOrNull(values.gps_latitude),
      gps_longitude: numberOrNull(values.gps_longitude),
      electricity_bill_avg_units: numberOrNull(values.electricity_bill_avg_units),
      is_drone_survey: values.is_drone_survey,
      notes: values.notes || null,
    }

    const res = await fetch(`/api/surveys/${survey.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    const body = await res.json().catch(() => ({}))
    if (!res.ok) {
      setServerError(body.error ?? 'Could not save the survey.')
      return
    }

    router.push(`/technical/surveys/${survey.id}`)
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <section className="space-y-5">
        <h2 className="text-sm font-semibold text-brand-slate">Assignment</h2>

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
            {survey.site_visit_request_id && !survey.scheduled_date && (
              <p className="mt-1 text-xs text-status-warning">
                Sales is waiting on this date — it is the handoff step that stalls most often.
              </p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-5 border-t border-border-subtle pt-6">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Roof measurements</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            All optional — record what you measured. Stored as a flexible blob, so a partial record
            is normal rather than an error.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="usable_area_sqft" className={labelClass}>
              Usable area (sq ft)
            </label>
            <input
              id="usable_area_sqft"
              type="number"
              step="any"
              min="0"
              inputMode="decimal"
              {...register('usable_area_sqft')}
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="tilt_degrees" className={labelClass}>
              Tilt (degrees)
            </label>
            <input
              id="tilt_degrees"
              type="number"
              step="any"
              min="0"
              max="90"
              inputMode="decimal"
              {...register('tilt_degrees')}
              className={inputClass}
            />
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="orientation" className={labelClass}>
              Orientation
            </label>
            <select id="orientation" {...register('orientation')} className={inputClass}>
              <option value="">Not recorded</option>
              {ROOF_ORIENTATIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </div>

          <div className="sm:col-span-2">
            <label htmlFor="shading_notes" className={labelClass}>
              Shading and obstructions
            </label>
            <textarea
              id="shading_notes"
              rows={3}
              {...register('shading_notes')}
              placeholder="Water tank on the south-west corner, neighbour's tree shading after 3pm."
              className={inputClass}
            />
            {errors.shading_notes && (
              <p className="mt-1 text-xs text-status-danger">{errors.shading_notes.message}</p>
            )}
          </div>
        </div>
      </section>

      <section className="space-y-4 border-t border-border-subtle pt-6">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Location</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            A coordinate is a pair or it is nothing — enter both or leave both blank.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <div>
            <label htmlFor="gps_latitude" className={labelClass}>
              Latitude
            </label>
            <input
              id="gps_latitude"
              type="text"
              inputMode="decimal"
              placeholder="12.971600"
              {...register('gps_latitude')}
              className={inputClass}
            />
            {errors.gps_latitude && (
              <p className="mt-1 text-xs text-status-danger">{errors.gps_latitude.message}</p>
            )}
          </div>

          <div>
            <label htmlFor="gps_longitude" className={labelClass}>
              Longitude
            </label>
            <input
              id="gps_longitude"
              type="text"
              inputMode="decimal"
              placeholder="77.594600"
              {...register('gps_longitude')}
              className={inputClass}
            />
            {errors.gps_longitude && (
              <p className="mt-1 text-xs text-status-danger">{errors.gps_longitude.message}</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={captureLocation}
            disabled={locating}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
          >
            <Crosshair className="h-4 w-4 text-text-muted/60" />
            {locating ? 'Getting a fix…' : 'Use my current location'}
          </button>
          {locationNote && <p className="text-xs text-text-muted">{locationNote}</p>}
        </div>
      </section>

      <section className="space-y-5 border-t border-border-subtle pt-6">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Consumption</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            The bill file itself is uploaded from the survey page — it is a customer document and
            is kept in a private bucket.
          </p>
        </div>

        <div className="sm:w-1/2">
          <label htmlFor="electricity_bill_avg_units" className={labelClass}>
            Average monthly units (kWh)
          </label>
          <input
            id="electricity_bill_avg_units"
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            {...register('electricity_bill_avg_units')}
            className={inputClass}
          />
        </div>

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
            <span className="mt-0.5 block text-xs text-text-muted">
              A record that aerial imagery was used. Aerial shots upload as ordinary survey photos.
            </span>
          </span>
        </label>
      </section>

      <section className="border-t border-border-subtle pt-6">
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="notes"
          rows={4}
          {...register('notes')}
          placeholder="What you found on site, and anything the designer needs to know."
          className={inputClass}
        />
        {errors.notes && <p className="mt-1 text-xs text-status-danger">{errors.notes.message}</p>}
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
          {isSubmitting ? 'Saving…' : 'Save findings'}
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
