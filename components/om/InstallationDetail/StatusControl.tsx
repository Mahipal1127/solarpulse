'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { INSTALLATION_TRANSITIONS } from '@/lib/om/constants'
import { INSTALLATION_STATUS_LABELS } from '@/lib/format'
import type { InstallationStatus } from '@/lib/types'

/**
 * Moves an installation between statuses, offering only the transitions the state
 * machine allows from where it is (INSTALLATION_TRANSITIONS). The server re-checks
 * with assertTransition, so this is a convenience, not the guard: completing stamps
 * completed_date, and completed/cancelled are terminal, which is why they drop off
 * the menu once reached.
 */
export function StatusControl({
  installationId,
  status,
}: {
  installationId: string
  status: InstallationStatus
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const next = INSTALLATION_TRANSITIONS[status]

  async function moveTo(to: InstallationStatus) {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/installations/${installationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: to }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the status.')
      return
    }

    router.refresh()
  }

  if (next.length === 0) {
    return (
      <p className="text-xs text-text-muted">
        {INSTALLATION_STATUS_LABELS[status]} is a final state — no further changes.
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {next.map((to) => (
          <button
            key={to}
            onClick={() => moveTo(to)}
            disabled={pending}
            className="rounded-lg border border-border-subtle bg-white px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold hover:text-brand-gold disabled:opacity-60"
          >
            Move to {INSTALLATION_STATUS_LABELS[to]}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
