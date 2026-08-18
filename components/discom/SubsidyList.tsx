import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { AgingBadge } from '@/components/discom/AgingBadge'
import { formatCurrency, SUBSIDY_STATUS_STYLES, SUBSIDY_STATUS_LABELS } from '@/lib/format'
import { formatSubsidyScheme } from '@/lib/discom/constants'
import type { SubsidyWithAging } from '@/lib/discom/dashboard'

/**
 * The subsidy case table, sorted longest-stuck-first by the caller. Same aging-led
 * shape as the net-metering list — the days-in-status column is the point. Money is
 * numeric-from-string; formatCurrency wraps it in Number() safely.
 */
export function SubsidyList({
  cases,
  showAssignee,
  emptyTitle,
  emptyDescription,
}: {
  cases: SubsidyWithAging[]
  showAssignee: boolean
  emptyTitle: string
  emptyDescription: string
}) {
  if (cases.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Customer</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">In status</th>
            <th className="px-5 py-3">Eligible</th>
            {showAssignee && <th className="px-5 py-3">Liaison</th>}
          </tr>
        </thead>
        <tbody>
          {cases.map((c) => (
            <tr
              key={c.id}
              className="border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/discom/subsidy/${c.id}`}
                  className="font-medium text-brand-slate hover:text-brand-gold"
                >
                  {c.customer?.name ?? 'Unknown customer'}
                </Link>
                <p className="mt-0.5 truncate text-xs text-text-muted">
                  {formatSubsidyScheme(c.scheme)}
                  {c.installation?.address ? ` · ${c.installation.address}` : ''}
                </p>
              </td>
              <td className="px-5 py-3">
                <Badge className={SUBSIDY_STATUS_STYLES[c.status]}>
                  {SUBSIDY_STATUS_LABELS[c.status]}
                </Badge>
              </td>
              <td className="px-5 py-3">
                <AgingBadge days={c.daysInStatus} isStale={c.isStale} />
              </td>
              <td className="px-5 py-3 text-text-muted">
                {c.eligible_subsidy_amount !== null
                  ? formatCurrency(Number(c.eligible_subsidy_amount))
                  : '—'}
              </td>
              {showAssignee && (
                <td className="px-5 py-3 text-text-muted">
                  {c.assignee?.full_name ?? 'Unassigned'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
