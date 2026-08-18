'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { LogIn, LogOut } from 'lucide-react'
import { formatDateTime } from '@/lib/format'

/**
 * The daily check-in / check-out control on the personal attendance page. Reachable by
 * every employee, HR or not. Both actions are bodyless POSTs — the server stamps the
 * time and resolves the employee from the session, so nothing here is trusted for
 * either. The buttons reflect today's row: check-in disabled once checked in,
 * check-out disabled until checked in and again once checked out.
 */
export function CheckInWidget({
  checkedInAt,
  checkedOutAt,
}: {
  checkedInAt: string | null
  checkedOutAt: string | null
}) {
  const router = useRouter()
  const [pending, setPending] = useState<'in' | 'out' | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function act(kind: 'in' | 'out') {
    setPending(kind)
    setError(null)
    const res = await fetch(`/api/attendance/check-${kind}`, { method: 'POST' })
    const body = await res.json().catch(() => ({}))
    setPending(null)
    if (!res.ok) {
      setError(body.error ?? 'Could not record that.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => act('in')}
          disabled={pending !== null || Boolean(checkedInAt)}
          className="inline-flex items-center gap-2 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
        >
          <LogIn className="h-4 w-4" />
          {checkedInAt ? 'Checked in' : pending === 'in' ? 'Checking in…' : 'Check in'}
        </button>
        <button
          onClick={() => act('out')}
          disabled={pending !== null || !checkedInAt || Boolean(checkedOutAt)}
          className="inline-flex items-center gap-2 rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-brand-slate transition-colors hover:bg-surface-bg disabled:opacity-50"
        >
          <LogOut className="h-4 w-4" />
          {checkedOutAt ? 'Checked out' : pending === 'out' ? 'Checking out…' : 'Check out'}
        </button>
      </div>

      <div className="text-xs text-text-muted">
        {checkedInAt ? (
          <p>Checked in at {formatDateTime(checkedInAt)}</p>
        ) : (
          <p>You have not checked in today.</p>
        )}
        {checkedOutAt && <p>Checked out at {formatDateTime(checkedOutAt)}</p>}
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
