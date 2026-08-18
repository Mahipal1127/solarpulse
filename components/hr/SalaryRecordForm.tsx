'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { SALARY_STATUSES } from '@/lib/hr/constants'
import { SALARY_STATUS_LABELS, formatCurrency } from '@/lib/format'
import type { SalaryStatus } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Creates a salary record — SENSITIVE. Only rendered for the HR lead / CEO (the page
 * gates before this ever mounts). net_payable is shown as a live preview but NEVER sent:
 * the database generates it from the parts, so the preview here is purely informational
 * and the server ignores any net figure a client might try to submit.
 */
export function SalaryRecordForm({
  employees,
}: {
  employees: { employee_id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState('')
  const [month, setMonth] = useState('')
  const [base, setBase] = useState('')
  const [bonus, setBonus] = useState('')
  const [incentives, setIncentives] = useState('')
  const [deductions, setDeductions] = useState('')
  const [status, setStatus] = useState<SalaryStatus>('draft')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const netPreview =
    (Number(base) || 0) + (Number(bonus) || 0) + (Number(incentives) || 0) - (Number(deductions) || 0)

  async function save() {
    if (!employeeId) return setError('Select an employee.')
    if (!month) return setError('Pick the effective month.')
    if (!base) return setError('Enter the base salary.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/salary-records', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        // month input gives 'YYYY-MM'; the API expects a date, service normalises to the 1st.
        effective_month: `${month}-01`,
        base_salary: Number(base),
        bonus: bonus ? Number(bonus) : 0,
        incentives: incentives ? Number(incentives) : 0,
        deductions: deductions ? Number(deductions) : 0,
        status,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the salary record.')
      return
    }

    setBase('')
    setBonus('')
    setIncentives('')
    setDeductions('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="sal-emp" className={labelClass}>
            Employee
          </label>
          <select
            id="sal-emp"
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
          <label htmlFor="sal-month" className={labelClass}>
            Effective month
          </label>
          <input
            id="sal-month"
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <label htmlFor="sal-base" className={labelClass}>
            Base (₹)
          </label>
          <input
            id="sal-base"
            type="number"
            min="0"
            value={base}
            onChange={(e) => setBase(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="sal-bonus" className={labelClass}>
            Bonus (₹)
          </label>
          <input
            id="sal-bonus"
            type="number"
            min="0"
            value={bonus}
            onChange={(e) => setBonus(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="sal-inc" className={labelClass}>
            Incentives (₹)
          </label>
          <input
            id="sal-inc"
            type="number"
            min="0"
            value={incentives}
            onChange={(e) => setIncentives(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="sal-ded" className={labelClass}>
            Deductions (₹)
          </label>
          <input
            id="sal-ded"
            type="number"
            min="0"
            value={deductions}
            onChange={(e) => setDeductions(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <label htmlFor="sal-status" className={labelClass}>
            Status
          </label>
          <select
            id="sal-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as SalaryStatus)}
            className={`${inputClass} w-40`}
          >
            {SALARY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {SALARY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <p className="text-sm text-text-muted">
          Net payable:{' '}
          <span className="font-semibold text-brand-slate">{formatCurrency(netPreview)}</span>
        </p>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Create salary record'}
      </button>
    </div>
  )
}
