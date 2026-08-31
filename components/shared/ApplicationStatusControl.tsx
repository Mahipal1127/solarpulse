'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { APPLICATION_STATUS_LABELS } from '@/lib/format'
import type { ApplicationStatus } from '@/lib/types'

const STATUSES: readonly ApplicationStatus[] = ['submitted', 'acknowledged', 'closed']

/**
 * The addressed side (HR members for hr/both, CEO for ceo/both) advancing one
 * application's lifecycle. A small inline select — the only mutation on the inbox. RLS is
 * the real gate; a caller not on the addressed side would get a 404 from the PATCH.
 */
export function ApplicationStatusControl({
  applicationId,
  status,
}: {
  applicationId: string
  status: ApplicationStatus
}) {
  const router = useRouter()
  const [value, setValue] = useState<ApplicationStatus>(status)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(false)

  async function change(next: ApplicationStatus) {
    const previous = value
    setValue(next)
    setPending(true)
    setError(false)

    const res = await fetch(`/api/applications/${applicationId}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    setPending(false)
    if (!res.ok) {
      setValue(previous)
      setError(true)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => change(e.target.value as ApplicationStatus)}
        className="rounded-lg border border-border-subtle px-2 py-1 text-xs outline-none focus:border-brand-gold disabled:opacity-60"
        aria-label="Application status"
      >
        {STATUSES.map((s) => (
          <option key={s} value={s}>
            {APPLICATION_STATUS_LABELS[s]}
          </option>
        ))}
      </select>
      {error && <span className="text-xs text-status-danger">⚠</span>}
    </div>
  )
}
