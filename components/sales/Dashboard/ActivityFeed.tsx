import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { formatCurrency, formatDateTime, hoursSince, daysSince } from '@/lib/format'
import type { ActivityEntry } from '@/lib/sales/dashboard'

const KIND_STYLES: Record<ActivityEntry['kind'], string> = {
  quotation: 'bg-brand-gold/15 text-white ring-brand-gold/30',
  proposal: 'bg-status-info/10 text-status-info ring-status-info/25',
  closure: 'bg-status-success/10 text-status-success ring-status-success/25',
  follow_up: 'bg-status-info/10 text-status-info ring-status-info/25',
}

const KIND_LABELS: Record<ActivityEntry['kind'], string> = {
  quotation: 'Quotation',
  proposal: 'Proposal',
  closure: 'Closed',
  follow_up: 'Follow-up',
}

/**
 * Assembled from the sales tables, not from audit_logs — that table is
 * CEO-read-only by policy, so building this feed on it would leave every
 * executive staring at an empty panel.
 */
export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) {
    return (
      <EmptyState
        title="No activity yet"
        description="Quotations, proposals, completed follow-ups, and closed deals show up here as they happen."
      />
    )
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {entries.map((entry) => (
        <li key={entry.id} className="flex items-start justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className={KIND_STYLES[entry.kind]}>{KIND_LABELS[entry.kind]}</Badge>
              {entry.leadId && entry.leadName ? (
                <Link
                  href={`/sales/leads/${entry.leadId}`}
                  className="truncate text-sm font-medium text-brand-slate hover:text-brand-slate"
                >
                  {entry.leadName}
                </Link>
              ) : (
                <span className="text-sm text-text-muted">Lead unavailable</span>
              )}
            </div>
            <p className="text-xs capitalize text-text-muted">
              {entry.summary}
              {entry.amount !== null && (
                <span className="font-medium text-text-muted"> · {formatCurrency(entry.amount)}</span>
              )}
            </p>
          </div>

          <span
            className="shrink-0 text-xs text-text-muted/60"
            title={formatDateTime(entry.at)}
          >
            {relativeTime(entry.at)}
          </span>
        </li>
      ))}
    </ul>
  )
}

function relativeTime(value: string): string {
  const hours = hoursSince(value)
  if (hours < 1) return 'just now'
  if (hours < 24) return `${hours}h ago`

  const days = daysSince(value)
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  return formatDateTime(value).split(',')[0]
}
