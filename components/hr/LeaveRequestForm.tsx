'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LEAVE_TYPES } from '@/lib/hr/constants'
import { LEAVE_TYPE_LABELS, leaveDayCount } from '@/lib/format'
import type { LeaveType } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Submit a leave request. Open to every employee — the server derives the employee from
 * the session, so this form never carries an employee id. On submit the server creates
 * the request AND its linked approval in one transaction; the decision happens on the
 * CEO's Approvals page and flows back to the request's status.
 */
export function LeaveRequestForm() {
  const router = useRouter()
  const [leaveType, setLeaveType] = useState<LeaveType>('casual')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const days = startDate && endDate ? leaveDayCount(startDate, endDate) : 0

  async function save() {
    if (!startDate || !endDate) return setError('Pick a start and end date.')
    if (days <= 0) return setError('The end date must be on or after the start date.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        leave_type: leaveType,
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not submit the request.')
      return
    }

    setStartDate('')
    setEndDate('')
    setReason('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="l-type" className={labelClass}>
            Leave type
          </label>
          <select
            id="l-type"
            value={leaveType}
            onChange={(e) => setLeaveType(e.target.value as LeaveType)}
            className={inputClass}
          >
            {LEAVE_TYPES.map((t) => (
              <option key={t} value={t}>
                {LEAVE_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="l-start" className={labelClass}>
            Start date
          </label>
          <input
            id="l-start"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="l-end" className={labelClass}>
            End date
          </label>
          <input
            id="l-end"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="l-reason" className={labelClass}>
          Reason (optional)
        </label>
        <textarea
          id="l-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>

      {days > 0 && (
        <p className="text-xs text-text-muted">
          {days} day{days === 1 ? '' : 's'} of leave requested.
        </p>
      )}
      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Submit request'}
      </button>
    </div>
  )
}
