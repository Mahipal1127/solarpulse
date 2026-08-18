'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Inline "report an issue" form for the facility page. Kept compact — the facility log is a
 * lightweight tracker, so reporting is a single field rather than its own route.
 */
export function FacilityIssueForm() {
  const router = useRouter()
  const [issue, setIssue] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (issue.trim().length < 1) {
      setError('Describe the issue.')
      return
    }

    setPending(true)
    const res = await fetch('/api/facility', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ issue: issue.trim() }),
    })
    setPending(false)

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not log the issue.')
      return
    }

    setIssue('')
    router.refresh()
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3 px-5 py-4">
      <div className="min-w-64 flex-1">
        <label
          htmlFor="facility-issue"
          className="mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted"
        >
          Report an issue
        </label>
        <input
          id="facility-issue"
          value={issue}
          onChange={(e) => setIssue(e.target.value)}
          placeholder="e.g. AC in the store room not cooling"
          className="w-full rounded-lg border border-border-subtle px-3 py-2.5 text-sm outline-none focus:border-brand-gold"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Logging…' : 'Log issue'}
      </button>
      {error && <p className="w-full text-xs text-status-danger">⚠ {error}</p>}
    </form>
  )
}
