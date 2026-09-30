'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { RooftopProjectStatus } from '@/lib/types'
import { ROOFTOP_TRANSITIONS } from '@/lib/rooftop/constants'

/**
 * The picker offers only what the server will accept; the server re-checks
 * against the same transitions map.
 */
export function ProjectStatusControl({
  projectId,
  currentStatus,
  disabled,
}: {
  projectId: string
  currentStatus: RooftopProjectStatus
  disabled?: boolean
}) {
  const router = useRouter()
  const [value, setValue] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const options = ROOFTOP_TRANSITIONS[currentStatus] ?? []

  if (disabled || options.length === 0) return null

  async function onMove(next: string) {
    if (!next) return
    setError(null)
    setSubmitting(true)
    setValue('')

    const res = await fetch(`/api/rooftop/${projectId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    const body = await res.json().catch(() => ({}))
    setSubmitting(false)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the status.')
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col items-stretch gap-1 sm:items-end">
      <label className="sr-only" htmlFor={`status-${projectId}`}>
        Move status forward
      </label>
      <select
        id={`status-${projectId}`}
        value={value}
        disabled={submitting}
        onChange={(e) => onMove(e.target.value)}
        className="w-full rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-sm outline-none transition-colors focus:border-brand-gold disabled:opacity-60 sm:w-auto"
      >
        <option value="">{submitting ? 'Moving…' : 'Move status…'}</option>
        {options.map((s) => (
          <option key={s} value={s}>
            {s.replace('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
          </option>
        ))}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  )
}
