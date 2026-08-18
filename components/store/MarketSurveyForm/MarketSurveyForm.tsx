'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Logs a market-survey field note. A lightweight record — area, observations, date. */

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold transition-colors'
const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function MarketSurveyForm() {
  const router = useRouter()
  const [area, setArea] = useState('')
  const [observations, setObservations] = useState('')
  const [surveyDate, setSurveyDate] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (area.trim().length < 1) {
      setError('Enter the area surveyed.')
      return
    }
    if (observations.trim().length < 1) {
      setError('Enter your observations.')
      return
    }

    setPending(true)
    const res = await fetch('/api/market-survey', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        area: area.trim(),
        observations: observations.trim(),
        survey_date: surveyDate || null,
      }),
    })
    const body = await res.json().catch(() => ({}))
    setPending(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not save the note.')
      return
    }

    router.push('/store/market-survey')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="space-y-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <label htmlFor="area" className={labelClass}>
            Area <span className="text-status-danger">*</span>
          </label>
          <input
            id="area"
            value={area}
            onChange={(e) => setArea(e.target.value)}
            placeholder="e.g. Sector 12, Faridabad"
            className={inputClass}
          />
        </div>

        <div>
          <label htmlFor="date" className={labelClass}>
            Survey date{' '}
            <span className="font-normal normal-case text-text-muted/60">(defaults to today)</span>
          </label>
          <input
            id="date"
            type="date"
            value={surveyDate}
            onChange={(e) => setSurveyDate(e.target.value)}
            className={inputClass}
          />
        </div>

        <div className="sm:col-span-2">
          <label htmlFor="observations" className={labelClass}>
            Observations <span className="text-status-danger">*</span>
          </label>
          <textarea
            id="observations"
            rows={6}
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            placeholder="What you saw in the field — demand, competitors, rooftop potential, anything worth noting."
            className={inputClass}
          />
        </div>
      </div>

      {error && (
        <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">
          ⚠ {error}
        </p>
      )}

      <div className="flex items-center gap-3 border-t border-border-subtle pt-5">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-brand-gold px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60"
        >
          {pending ? 'Saving…' : 'Save note'}
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
