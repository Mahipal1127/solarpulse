'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Onboards a new employee — creates the login, users row, and employees row together
 * (server-side, HR-lead / CEO only). Shown only to the HR lead. The role picker places
 * the hire in a department; reporting_to is optional.
 */
export function OnboardEmployeeForm({
  roles,
  users,
}: {
  roles: { id: string; name: string; department_name: string | null }[]
  users: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [roleId, setRoleId] = useState('')
  const [designation, setDesignation] = useState('')
  const [employeeCode, setEmployeeCode] = useState('')
  const [dateJoined, setDateJoined] = useState('')
  const [reportingTo, setReportingTo] = useState('')
  const [emergency, setEmergency] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  async function save() {
    if (fullName.trim().length < 2) return setError('Enter the full name.')
    if (!email.trim()) return setError('Enter an email.')
    if (!roleId) return setError('Select a role.')

    setPending(true)
    setError(null)
    setDone(null)

    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        full_name: fullName.trim(),
        email: email.trim(),
        phone: phone.trim() || null,
        role_id: roleId,
        designation: designation.trim() || null,
        employee_code: employeeCode.trim() || null,
        date_joined: dateJoined || null,
        reporting_to: reportingTo || null,
        emergency_contact: emergency.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not onboard the employee.')
      return
    }

    setDone(`${fullName.trim()} onboarded. They can sign in with a password reset.`)
    setFullName('')
    setEmail('')
    setPhone('')
    setRoleId('')
    setDesignation('')
    setEmployeeCode('')
    setDateJoined('')
    setReportingTo('')
    setEmergency('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="on-name" className={labelClass}>
            Full name
          </label>
          <input
            id="on-name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="on-email" className={labelClass}>
            Email
          </label>
          <input
            id="on-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="on-role" className={labelClass}>
            Role
          </label>
          <select
            id="on-role"
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.department_name ? ` · ${r.department_name}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="on-desig" className={labelClass}>
            Designation
          </label>
          <input
            id="on-desig"
            value={designation}
            onChange={(e) => setDesignation(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="on-code" className={labelClass}>
            Employee code
          </label>
          <input
            id="on-code"
            value={employeeCode}
            onChange={(e) => setEmployeeCode(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="on-phone" className={labelClass}>
            Phone
          </label>
          <input
            id="on-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="on-joined" className={labelClass}>
            Date joined
          </label>
          <input
            id="on-joined"
            type="date"
            value={dateJoined}
            onChange={(e) => setDateJoined(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="on-report" className={labelClass}>
            Reports to
          </label>
          <select
            id="on-report"
            value={reportingTo}
            onChange={(e) => setReportingTo(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="on-emergency" className={labelClass}>
            Emergency contact
          </label>
          <input
            id="on-emergency"
            value={emergency}
            onChange={(e) => setEmergency(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
      {done && <p className="text-xs text-status-success">✓ {done}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Onboarding…' : 'Onboard employee'}
      </button>
    </div>
  )
}
