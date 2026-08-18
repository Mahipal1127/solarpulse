'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge } from '@/components/ui/primitives'
import { CONTENT_STATUS_STYLES, CONTENT_STATUS_LABELS } from '@/lib/format'
import { CONTENT_STATUSES } from '@/lib/marketing/constants'
import type { ContentStatus } from '@/lib/types'

/**
 * Moves a content item to a new status. Unlike DISCOM's cases there is no history
 * table and no aging clock — content status is an ordinary field, so this is a plain
 * PATCH to /api/content-calendar/[itemId]. Offers every status except the current one.
 */
export function ContentStatusControl({
  itemId,
  current,
  disabled,
}: {
  itemId: string
  current: ContentStatus
  disabled?: boolean
}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function change(status: ContentStatus) {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/content-calendar/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not change the status.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Status</span>
        <Badge className={CONTENT_STATUS_STYLES[current]}>{CONTENT_STATUS_LABELS[current]}</Badge>
      </div>

      {!disabled && (
        <div className="flex flex-wrap gap-1.5">
          {CONTENT_STATUSES.filter((s) => s !== current).map((s) => (
            <button
              key={s}
              onClick={() => change(s)}
              disabled={pending}
              className="rounded-lg border border-border-subtle px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:border-brand-gold hover:text-brand-gold disabled:opacity-60"
            >
              → {CONTENT_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}
