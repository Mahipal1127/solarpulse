'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { BUDGET_ALWAYS_REQUIRES_APPROVAL } from '@/lib/finance/constants'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

export interface DepartmentOption {
  id: string
  name: string
}

/**
 * Allocates a budget to a department (or org-wide) over a period. Lead/CEO only — the page
 * gates before this mounts and the service re-checks. Actual spend is computed at query time
 * against this allocation, never stored here. Budgets always route through a CEO approval
 * (BUDGET_ALWAYS_REQUIRES_APPROVAL), so an approval ID is required.
 */
export function BudgetForm({ departments }: { departments: DepartmentOption[] }) {
  const router = useRouter()
  const [departmentId, setDepartmentId] = useState('')
  const [periodStart, setPeriodStart] = useState('')
  const [periodEnd, setPeriodEnd] = useState('')
  const [allocated, setAllocated] = useState('')
  const [approvalId, setApprovalId] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!periodStart || !periodEnd) return setError('Set the budget period.')
    if (new Date(periodEnd) < new Date(periodStart))
      return setError('Period end must be on or after period start.')
    if ((Number(allocated) || 0) <= 0) return setError('Enter an allocation greater than zero.')
    if (BUDGET_ALWAYS_REQUIRES_APPROVAL && !approvalId.trim())
      return setError('Budgets require a linked CEO approval.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/budgets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        department_id: departmentId || null,
        period_start: periodStart,
        period_end: periodEnd,
        allocated_amount: Number(allocated),
        approval_id: approvalId.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not create the budget.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="bud-dept" className={labelClass}>
            Department
          </label>
          <select
            id="bud-dept"
            value={departmentId}
            onChange={(e) => setDepartmentId(e.target.value)}
            className={inputClass}
          >
            <option value="">Org-wide (all departments)</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bud-alloc" className={labelClass}>
            Allocated amount
          </label>
          <input
            id="bud-alloc"
            type="number"
            min="0"
            step="0.01"
            value={allocated}
            onChange={(e) => setAllocated(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="bud-start" className={labelClass}>
            Period start
          </label>
          <input
            id="bud-start"
            type="date"
            value={periodStart}
            onChange={(e) => setPeriodStart(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="bud-end" className={labelClass}>
            Period end
          </label>
          <input
            id="bud-end"
            type="date"
            value={periodEnd}
            onChange={(e) => setPeriodEnd(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="bud-approval" className={labelClass}>
          Approval ID
        </label>
        <input
          id="bud-approval"
          value={approvalId}
          onChange={(e) => setApprovalId(e.target.value)}
          placeholder="CEO approval UUID"
          className={inputClass}
        />
        <p className="mt-1 text-xs text-text-muted">
          Every budget is CEO-approved. Raise the approval first, then link it here.
        </p>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Creating…' : 'Create budget'}
      </button>
    </div>
  )
}
