'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Sparkles, Check } from 'lucide-react'
import { EmptyState } from '@/components/ui/primitives'
import { formatDate, formatDateTime } from '@/lib/format'
import type { InsightRow } from '@/lib/marketing/dashboard'

/**
 * The AI marketing insights feed — READ-ONLY here. The CEO module's AI Marketing
 * Officer writes these (via the service-role client); this module only reads them and
 * lets the team acknowledge one (the single write allowed, an UPDATE — there is no
 * client insert path, by design).
 *
 * Empty-state safe: if the AI system has not run, `insights` is [] and this renders a
 * calm empty state rather than erroring. The table exists from 0014 regardless.
 */
export function InsightFeed({ insights }: { insights: InsightRow[] }) {
  if (insights.length === 0) {
    return (
      <EmptyState
        title="No insights yet"
        description="When the AI Marketing Officer reviews your campaigns and content, its recommendations show up here."
      />
    )
  }

  return (
    <ul className="space-y-3">
      {insights.map((insight) => (
        <InsightCard key={insight.id} insight={insight} />
      ))}
    </ul>
  )
}

function InsightCard({ insight }: { insight: InsightRow }) {
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const acknowledged = insight.acknowledged_by !== null

  async function acknowledge() {
    setPending(true)
    setError(null)
    const res = await fetch(`/api/insights/${insight.id}/acknowledge`, { method: 'PATCH' })
    setPending(false)
    if (!res.ok) {
      const b = await res.json().catch(() => ({}))
      setError(b.error ?? 'Could not acknowledge.')
      return
    }
    router.refresh()
  }

  return (
    <li
      className={`rounded-2xl border bg-surface-card px-5 py-4 ${
        acknowledged ? 'border-border-subtle' : 'border-brand-gold/40'
      }`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-gold/10 text-brand-gold">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-text-muted">{formatDate(insight.insight_date)}</p>
            {acknowledged ? (
              <span className="inline-flex items-center gap-1 text-xs text-status-success">
                <Check className="h-3.5 w-3.5" />
                Acknowledged
                {insight.acknowledger?.full_name && ` by ${insight.acknowledger.full_name}`}
                {insight.acknowledged_at && ` · ${formatDateTime(insight.acknowledged_at)}`}
              </span>
            ) : (
              <button
                onClick={acknowledge}
                disabled={pending}
                className="rounded-lg border border-border-subtle px-3 py-1 text-xs font-medium text-text-muted transition-colors hover:border-brand-gold hover:text-brand-gold disabled:opacity-60"
              >
                {pending ? 'Saving…' : 'Acknowledge'}
              </button>
            )}
          </div>
          <p className="mt-1.5 text-sm text-brand-slate">{insight.summary}</p>
          {insight.recommendation && (
            <p className="mt-2 rounded-lg bg-surface-bg px-3 py-2 text-sm text-text-muted">
              <span className="font-medium text-brand-slate">Recommendation: </span>
              {insight.recommendation}
            </p>
          )}
          {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}
        </div>
      </div>
    </li>
  )
}
