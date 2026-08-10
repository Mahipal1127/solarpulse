import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  daysSince,
  LEAD_STATUS_STYLES,
  LEAD_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
} from '@/lib/format'
import type { LeadRow } from '@/components/sales/LeadPipeline/LeadPipeline'

/**
 * Row view of the same leads the kanban shows. The board answers "where is
 * everything", this answers "what is this lead" — phone, source, and owner are
 * legible without opening the card.
 */
export function LeadList({
  leads,
  showAssignee = false,
  emptyTitle = 'No leads match these filters',
  emptyDescription,
}: {
  leads: LeadRow[]
  showAssignee?: boolean
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (leads.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="divide-y divide-border-subtle">
      {leads.map((lead) => {
        const age = daysSince(lead.created_at)

        return (
          <Link
            key={lead.id}
            href={`/sales/leads/${lead.id}`}
            className="block px-5 py-4 transition hover:bg-surface-bg"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="truncate text-sm font-semibold text-brand-slate">{lead.name}</h3>
                  {lead.property_type && (
                    <span className="text-xs text-text-muted">
                      {PROPERTY_TYPE_LABELS[lead.property_type]}
                    </span>
                  )}
                  {lead.estimated_load_kw !== null && (
                    <span className="text-xs text-text-muted">· {lead.estimated_load_kw} kW</span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  {lead.phone && <span className="font-medium text-text-muted">{lead.phone}</span>}
                  {lead.email && (
                    <>
                      {lead.phone && <span>·</span>}
                      <span className="truncate">{lead.email}</span>
                    </>
                  )}
                  {lead.source && (
                    <>
                      {(lead.phone || lead.email) && <span>·</span>}
                      <span>{LEAD_SOURCE_LABELS[lead.source] ?? lead.source}</span>
                    </>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <span>Added {formatDate(lead.created_at)}</span>
                  <span>·</span>
                  <span>{age === 0 ? 'today' : `${age} days ago`}</span>
                  {showAssignee && (
                    <>
                      <span>·</span>
                      <span className="font-medium text-text-muted">
                        {lead.assignee?.full_name ?? 'Unassigned'}
                      </span>
                    </>
                  )}
                </div>
              </div>

              <Badge className={`shrink-0 ${LEAD_STATUS_STYLES[lead.status]}`}>
                {LEAD_STATUS_LABELS[lead.status]}
              </Badge>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
