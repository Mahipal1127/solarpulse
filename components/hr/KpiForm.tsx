'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/** Sets a KPI for an employee — HR lead / CEO only (the page gates before this mounts). */
export function KpiForm({
  employees,
}: {
  employees: { employee_id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [employeeId, setEmployeeId] = useState('')
  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!employeeId) return setError('Select an employee.')
    if (!start || !end) return setError('Set the KPI period.')
    if (description.trim().length < 3) return setError('Describe the KPI.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/performance-kpis', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employee_id: employeeId,
        period_start: start,
        period_end: end,
        kpi_description: description.trim(),
        target_value: target.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not set the KPI.')
      return
    }

    setDescription('')
    setTarget('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label htmlFor="kpi-emp" className={labelClass}>
            Employee
          </label>
          <select
            id="kpi-emp"
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
          <label htmlFor="kpi-start" className={labelClass}>
            Period start
          </label>
          <input
            id="kpi-start"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="kpi-end" className={labelClass}>
            Period end
          </label>
          <input
            id="kpi-end"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="kpi-desc" className={labelClass}>
          KPI
        </label>
        <input
          id="kpi-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g. Close 8 residential deals"
          className={inputClass}
        />
      </div>
      <div>
        <label htmlFor="kpi-target" className={labelClass}>
          Target (optional)
        </label>
        <input
          id="kpi-target"
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder="e.g. 8 deals"
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Saving…' : 'Set KPI'}
      </button>
    </div>
  )
}
