import { Badge, EmptyState } from '@/components/ui/primitives'
import { DEALER_STATUS_LABELS, DEALER_STATUS_STYLES } from '@/lib/format'
import type { Dealer } from '@/lib/types'

/**
 * The dealer contact list — a simple relationship log per the scope, not a Sales pipeline.
 * Presentational; RLS decides which rows arrive (department-wide for any Store member).
 */
export function DealerList({ dealers }: { dealers: Dealer[] }) {
  if (dealers.length === 0) {
    return (
      <EmptyState
        title="No dealers yet"
        description="Add a dealer to start tracking the network."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Dealer</th>
            <th className="px-5 py-3">Contact</th>
            <th className="px-5 py-3">Location</th>
            <th className="px-5 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {dealers.map((dealer) => (
            <tr
              key={dealer.id}
              className="border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg"
            >
              <td className="px-5 py-3">
                <p className="font-medium text-brand-slate">{dealer.name}</p>
                {dealer.notes && (
                  <p className="mt-0.5 max-w-md truncate text-xs text-text-muted">{dealer.notes}</p>
                )}
              </td>
              <td className="px-5 py-3 text-text-muted">
                {dealer.contact_person ?? '—'}
                {dealer.phone && <p className="text-xs">{dealer.phone}</p>}
              </td>
              <td className="px-5 py-3 text-text-muted">{dealer.location ?? '—'}</td>
              <td className="px-5 py-3">
                <Badge className={DEALER_STATUS_STYLES[dealer.relationship_status]}>
                  {DEALER_STATUS_LABELS[dealer.relationship_status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
