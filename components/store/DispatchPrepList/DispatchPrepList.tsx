import { Badge, EmptyState } from '@/components/ui/primitives'
import { formatDateTime } from '@/lib/format'
import type { DispatchPrepRow } from '@/lib/store/dashboard'

/**
 * A READ-ONLY view of Distribution's dispatches still in 'preparing' — what has been staged
 * and is waiting to go out the door, so Store can have the physical stock ready. Distribution
 * (0007) owns dispatch end to end; this page neither creates nor mutates a dispatch, and links
 * through to Distribution for anyone who needs to act on one. Thin by design until Distribution
 * defines the formal Store handoff contract.
 */
export function DispatchPrepList({ rows }: { rows: DispatchPrepRow[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="Nothing staged for dispatch"
        description="Dispatches Distribution is preparing appear here so you can ready the stock. They are created and managed in the Distribution module."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Dispatch</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3 text-right">Items</th>
            <th className="px-5 py-3">Vehicle</th>
            <th className="px-5 py-3">Created</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg"
            >
              <td className="px-5 py-3 font-medium text-brand-slate">{row.dispatch_number}</td>
              <td className="px-5 py-3">
                <Badge className="badge-warning">Preparing</Badge>
              </td>
              <td className="px-5 py-3 text-right tabular-nums text-text-muted">{row.item_count}</td>
              <td className="px-5 py-3 text-text-muted">{row.vehicle_details ?? '—'}</td>
              <td className="px-5 py-3 text-text-muted">{formatDateTime(row.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
