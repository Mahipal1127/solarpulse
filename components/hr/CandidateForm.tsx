'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CANDIDATE_SOURCES } from '@/lib/hr/constants'
import { CANDIDATE_SOURCE_LABELS } from '@/lib/format'
import type { CandidateSource } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/** Adds a recruitment candidate. Any HR member. */
export function CandidateForm({
  departments,
}: {
  departments: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [dept, setDept] = useState('')
  const [role, setRole] = useState('')
  const [source, setSource] = useState<CandidateSource | ''>('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (name.trim().length < 2) return setError('Enter the candidate name.')
    setPending(true)
    setError(null)

    const res = await fetch('/api/candidates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        applied_for_department_id: dept || null,
        applied_for_role: role.trim() || null,
        source: source || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not add the candidate.')
      return
    }

    setName('')
    setPhone('')
    setEmail('')
    setDept('')
    setRole('')
    setSource('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="cand-name" className={labelClass}>
            Name
          </label>
          <input
            id="cand-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="cand-phone" className={labelClass}>
            Phone
          </label>
          <input
            id="cand-phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="cand-email" className={labelClass}>
            Email
          </label>
          <input
            id="cand-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="cand-source" className={labelClass}>
            Source
          </label>
          <select
            id="cand-source"
            value={source}
            onChange={(e) => setSource(e.target.value as CandidateSource | '')}
            className={inputClass}
          >
            <option value="">—</option>
            {CANDIDATE_SOURCES.map((s) => (
              <option key={s} value={s}>
                {CANDIDATE_SOURCE_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cand-dept" className={labelClass}>
            Applying for department
          </label>
          <select
            id="cand-dept"
            value={dept}
            onChange={(e) => setDept(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cand-role" className={labelClass}>
            Applying for role
          </label>
          <input
            id="cand-role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            placeholder="e.g. Site Engineer"
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Adding…' : 'Add candidate'}
      </button>
    </div>
  )
}
