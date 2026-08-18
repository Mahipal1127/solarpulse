'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ATTENDANCE_STATUSES } from '@/lib/hr/constants'
import { ATTENDANCE_STATUS_LABELS } from '@/lib/format'
import type { AttendanceStatus } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * HR marks attendance for an employee — for field staff who could not self-check-in, or
 * to record absence/leave/holiday. Upserts on (employee, date). Defaults the date to
 * today. The employee picker comes from the roster.
 */
export function MarkAttendanceForm({
  employees,
  defaultDate,
}: {
  employees: { employee_id: string; full_name: string }[]
  defaultDate: string
}) {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState('')
  const [date, setDate] = useState(defaultDate)
  const [status, setStatus] = useState<AttendanceStatus>('present')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!employeeId) return setError('Select an employee.')
    setPending(true)
    setError(null)

    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ employee_id: employeeId, date, status }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not mark attendance.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="ma-emp" className={labelClass}>
            Employee
          </label>
          <select
            id="ma-emp"
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
          <label htmlFor="ma-date" className={labelClass}>
            Date
          </label>
          <input
            id="ma-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="ma-status" className={labelClass}>
            Status
          </label>
          <select
            id="ma-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
            className={inputClass}
          >
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {ATTENDANCE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Mark attendance'}
      </button>
    </div>
  )
}
