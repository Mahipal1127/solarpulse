'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Records an appraisal — SENSITIVE, as private as pay. Only rendered for the HR lead /
 * CEO (the page gates before this mounts). A single record per review period, not a
 * multi-stage workflow.
 */
export function AppraisalForm({
  employees,
}: {
  employees: { employee_id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState('')
  const [period, setPeriod] = useState('')
  const [rating, setRating] = useState('')
  const [strengths, setStrengths] = useState('')
  const [improve, setImprove] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!employeeId) return setError('Select an employee.')
    if (period.trim().length < 2) return setError('Name the review period.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/appraisals', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        review_period: period.trim(),
        rating: rating.trim() || null,
        strengths: strengths.trim() || null,
        areas_of_improvement: improve.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not record the appraisal.')
      return
    }

    setPeriod('')
    setRating('')
    setStrengths('')
    setImprove('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="ap-emp" className={labelClass}>
            Employee
          </label>
          <select
            id="ap-emp"
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {employees.map((e) => (
              <option key={e.employee_id} value={e.employee_id}>
                {e.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ap-period" className={labelClass}>
            Review period
          </label>
          <input
            id="ap-period"
            value={period}
            onChange={(e) => setPeriod(e.target.value)}
            placeholder="e.g. H1 2026"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ap-rating" className={labelClass}>
            Rating
          </label>
          <input
            id="ap-rating"
            value={rating}
            onChange={(e) => setRating(e.target.value)}
            placeholder="e.g. Exceeds"
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="ap-strengths" className={labelClass}>
          Strengths
        </label>
        <textarea
          id="ap-strengths"
          value={strengths}
          onChange={(e) => setStrengths(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="ap-improve" className={labelClass}>
          Areas of improvement
        </label>
        <textarea
          id="ap-improve"
          value={improve}
          onChange={(e) => setImprove(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Record appraisal'}
      </button>
    </div>
  )
}
