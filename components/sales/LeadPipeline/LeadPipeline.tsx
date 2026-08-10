import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  daysSince,
  LEAD_PIPELINE_ORDER,
  LEAD_OPEN_STAGES,
  LEAD_STATUS_STYLES,
  LEAD_STATUS_SHORT_LABELS,
  PROPERTY_TYPE_LABELS,
} from '@/lib/format'
import type { Lead, LeadStatus } from '@/lib/types'

export type LeadRow = Lead & {
  assignee: { full_name: string } | null
}

/**
 * The one kanban rendering. /sales/leads uses the full board; the personal
 * dashboard passes compact + stages=LEAD_OPEN_STAGES for its pipeline summary,
 * so a lead card never looks different depending on where you saw it.
 *
 * Deliberately a server component with no drag-and-drop: a stage change has side
 * effects (a quotation advances a lead, a closure is atomic), so it belongs to
 * the lead detail page's actions rather than to a drop target that would let
 * someone skip straight to 'won' without a closure record.
 */
export function LeadPipeline({
  leads,
  stages = LEAD_PIPELINE_ORDER,
  compact = false,
  showAssignee = false,
  emptyTitle = 'No leads in the pipeline',
  emptyDescription,
}: {
  leads: LeadRow[]
  stages?: LeadStatus[]
  compact?: boolean
  showAssignee?: boolean
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (leads.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  const byStage = new Map<LeadStatus, LeadRow[]>(stages.map((s) => [s, []]))
  for (const lead of leads) {
    byStage.get(lead.status)?.push(lead)
  }

  return (
    <div className="flex gap-3 overflow-x-auto p-4">
      {stages.map((stage) => {
        const column = byStage.get(stage) ?? []
        const load = column.reduce((sum, l) => sum + (l.estimated_load_kw ?? 0), 0)

        return (
          <div
            key={stage}
            className={`flex shrink-0 flex-col rounded-xl bg-surface-bg ${
              compact ? 'w-52' : 'w-64'
            }`}
          >
            <div className="flex items-center justify-between gap-2 border-b border-border-subtle px-3 py-2.5">
              <div className="flex items-center gap-2">
                <Badge className={LEAD_STATUS_STYLES[stage]}>
                  {LEAD_STATUS_SHORT_LABELS[stage]}
                </Badge>
                <span className="text-xs font-semibold text-text-muted">{column.length}</span>
              </div>
              {load > 0 && (
                <span className="shrink-0 text-xs text-text-muted">{round(load)} kW</span>
              )}
            </div>

            <div className="flex-1 space-y-2 p-2">
              {column.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-text-muted/60">Empty</p>
              ) : (
                column.map((lead) => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    compact={compact}
                    showAssignee={showAssignee}
                  />
                ))
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function LeadCard({
  lead,
  compact,
  showAssignee,
}: {
  lead: LeadRow
  compact: boolean
  showAssignee: boolean
}) {
  // Age matters most in the early stages — a lead sitting in 'new' for two weeks
  // is the signal the board exists to surface.
  const age = daysSince(lead.created_at)
  const stale = LEAD_OPEN_STAGES.includes(lead.status) && age >= 7

  return (
    <Link
      href={`/sales/leads/${lead.id}`}
      className="block rounded-lg border border-border-subtle bg-white px-3 py-2.5 shadow-sm transition hover:border-brand-gold/40 hover:shadow"
    >
      <p className="truncate text-sm font-semibold text-brand-slate">{lead.name}</p>

      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-text-muted">
        {lead.property_type && <span>{PROPERTY_TYPE_LABELS[lead.property_type]}</span>}
        {lead.estimated_load_kw !== null && (
          <>
            {lead.property_type && <span>·</span>}
            <span>{round(lead.estimated_load_kw)} kW</span>
          </>
        )}
      </div>

      {!compact && lead.phone && (
        <p className="mt-1 truncate text-xs text-text-muted">{lead.phone}</p>
      )}

      <div className="mt-2 flex items-center justify-between gap-2">
        <span className={`text-xs ${stale ? 'font-medium text-status-warning' : 'text-text-muted/60'}`}>
          {age === 0 ? 'Added today' : `${age}d old`}
        </span>
        {showAssignee && lead.assignee && (
          <span className="truncate text-xs text-text-muted">{lead.assignee.full_name}</span>
        )}
      </div>

      {!compact && !showAssignee && lead.source && (
        <p className="mt-1 text-xs text-text-muted/60">via {lead.source.replace(/_/g, ' ')}</p>
      )}
      {!compact && lead.status === 'won' && (
        <p className="mt-1 text-xs text-status-success">Closed {formatDate(lead.updated_at)}</p>
      )}
    </Link>
  )
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
