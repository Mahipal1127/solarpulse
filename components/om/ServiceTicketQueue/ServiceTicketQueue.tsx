import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDateTime,
  daysSince,
  SERVICE_TICKET_STATUS_STYLES,
  SERVICE_TICKET_STATUS_LABELS,
  SERVICE_PRIORITY_STYLES,
  SERVICE_PRIORITY_LABELS,
  formatIssueType,
} from '@/lib/format'
import type { ServiceTicketWithContext } from '@/lib/om/dashboard'

/**
 * The complaint queue. Presentational and server-rendered — RLS decides which
 * tickets a caller sees (a technician gets theirs plus the unassigned pool they can
 * claim, per the migration's service_tickets policy). Ordering is the page's job;
 * this just renders what it is handed.
 */
export function ServiceTicketQueue({
  tickets,
  emptyTitle,
  emptyDescription,
}: {
  tickets: ServiceTicketWithContext[]
  emptyTitle: string
  emptyDescription: string
}) {
  if (tickets.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {tickets.map((t) => (
        <li key={t.id} className="px-5 py-4 transition-colors hover:bg-surface-bg">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/om/service/${t.id}`}
                  className="font-medium text-brand-slate hover:text-brand-gold"
                >
                  {t.customer?.name ?? 'Unknown customer'}
                </Link>
                <Badge className={SERVICE_PRIORITY_STYLES[t.priority]}>
                  {SERVICE_PRIORITY_LABELS[t.priority]}
                </Badge>
                <Badge className={SERVICE_TICKET_STATUS_STYLES[t.status]}>
                  {SERVICE_TICKET_STATUS_LABELS[t.status]}
                </Badge>
                {t.issue_type && (
                  <span className="text-xs text-text-muted">{formatIssueType(t.issue_type)}</span>
                )}
              </div>
              <p className="mt-1 line-clamp-2 text-sm text-text-muted">{t.description}</p>
              <p className="mt-1 text-xs text-text-muted">
                {formatDateTime(t.created_at)} · {daysSince(t.created_at)} days open ·{' '}
                {t.assignee?.full_name ?? 'Unassigned'}
              </p>
            </div>
          </div>
        </li>
      ))}
    </ul>
  )
}
