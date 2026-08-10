import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  formatCurrency,
  isTenderOverdue,
  deadlineCountdown,
  TENDER_STATUS_STYLES,
  TENDER_STATUS_LABELS,
} from '@/lib/format'
import type { Tender } from '@/lib/types'

export type TenderRow = Tender & {
  assignee: { full_name: string } | null
}

/**
 * The single tender list rendering. The department's /tenders page uses the full
 * variant; the CEO's department drill-down passes compact so the same component
 * serves both rather than a second list UI drifting out of sync.
 */
export function TenderList({
  tenders,
  compact = false,
  emptyTitle = 'No tenders match these filters',
  emptyDescription,
}: {
  tenders: TenderRow[]
  compact?: boolean
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (tenders.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="divide-y divide-border-subtle">
      {tenders.map((tender) => {
        const overdue = isTenderOverdue(tender)
        const countdown = deadlineCountdown(tender)

        return (
          <Link
            key={tender.id}
            href={`/tenders/${tender.id}`}
            className={`block border-l-4 pl-4 pr-5 transition hover:bg-surface-bg ${
              overdue ? 'border-l-rose-500' : 'border-l-transparent'
            } ${compact ? 'py-3' : 'py-4'}`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-brand-slate">{tender.title}</h3>
                  {overdue && (
                    <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  {tender.issuing_authority && (
                    <span className="font-medium text-text-muted">{tender.issuing_authority}</span>
                  )}
                  {tender.tender_number && (
                    <>
                      {tender.issuing_authority && <span>·</span>}
                      <span className="font-mono">{tender.tender_number}</span>
                    </>
                  )}
                  {!compact && tender.assignee && (
                    <>
                      <span>·</span>
                      <span>{tender.assignee.full_name}</span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-text-muted">
                    Deadline {formatDate(tender.submission_deadline)}
                  </span>
                  {countdown && (
                    <span className={overdue ? 'font-medium text-status-danger' : 'text-text-muted'}>
                      · {countdown}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Badge className={TENDER_STATUS_STYLES[tender.status]}>
                  {TENDER_STATUS_LABELS[tender.status]}
                </Badge>
                {tender.estimated_value !== null && (
                  <span className="text-xs font-semibold text-text-muted">
                    {formatCurrency(tender.estimated_value)}
                  </span>
                )}
              </div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
