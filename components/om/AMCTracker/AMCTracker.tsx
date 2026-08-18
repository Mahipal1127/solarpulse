import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  formatCurrency,
  amcDisplayStatus,
  AMC_DISPLAY_STATUS_STYLES,
  AMC_DISPLAY_STATUS_LABELS,
  formatVisitFrequency,
} from '@/lib/format'
import type { AmcContractWithContext } from '@/lib/om/dashboard'

/**
 * The AMC book. The badge status is computed, not stored: amcDisplayStatus folds an
 * active contract into active / expiring-soon / expired from its end_date at render
 * time, so this list and the dashboard counts read the same source and cannot
 * disagree. Ordering (soonest-expiring first) is the page's job.
 */
export function AMCTracker({
  contracts,
  emptyTitle,
  emptyDescription,
}: {
  contracts: AmcContractWithContext[]
  emptyTitle: string
  emptyDescription: string
}) {
  if (contracts.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Customer</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">Coverage</th>
            <th className="px-5 py-3">Frequency</th>
            <th className="px-5 py-3">Value</th>
          </tr>
        </thead>
        <tbody>
          {contracts.map((c) => {
            const display = amcDisplayStatus(c)
            return (
              <tr
                key={c.id}
                className="border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg"
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/om/amc/${c.id}`}
                    className="font-medium text-brand-slate hover:text-brand-gold"
                  >
                    {c.customer?.name ?? 'Unknown customer'}
                  </Link>
                </td>
                <td className="px-5 py-3">
                  <Badge className={AMC_DISPLAY_STATUS_STYLES[display]}>
                    {AMC_DISPLAY_STATUS_LABELS[display]}
                  </Badge>
                </td>
                <td className="px-5 py-3 text-text-muted">
                  {formatDate(c.start_date)} → {formatDate(c.end_date)}
                </td>
                <td className="px-5 py-3 text-text-muted">
                  {formatVisitFrequency(c.visit_frequency)}
                </td>
                <td className="px-5 py-3 text-text-muted">
                  {c.amount !== null ? formatCurrency(c.amount) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
