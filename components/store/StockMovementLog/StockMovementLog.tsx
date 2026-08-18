import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  STOCK_MOVEMENT_TYPE_LABELS,
  STOCK_MOVEMENT_TYPE_STYLES,
  STOCK_INBOUND_TYPES,
  formatDateTime,
} from '@/lib/format'
import type { StockMovementWithContext } from '@/lib/store/dashboard'

/**
 * The append-only movement log. Presentational and server-rendered — RLS decides which rows
 * arrive. The quantity is shown signed by its effect on stock (+ for inbound, − for outbound)
 * so the ledger reads like a running account; an adjustment shows its own stored sign.
 */
export function StockMovementLog({
  movements,
  emptyTitle = 'No movements yet',
  emptyDescription = 'Logged stock movements appear here.',
}: {
  movements: StockMovementWithContext[]
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (movements.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">When</th>
            <th className="px-5 py-3">Item</th>
            <th className="px-5 py-3">Movement</th>
            <th className="px-5 py-3 text-right">Qty</th>
            <th className="px-5 py-3">By</th>
          </tr>
        </thead>
        <tbody>
          {movements.map((m) => {
            const inbound = STOCK_INBOUND_TYPES.includes(m.movement_type)
            // adjustment carries its own sign; the real types imply it from inbound/outbound.
            const signed =
              m.movement_type === 'adjustment'
                ? m.quantity
                : inbound
                  ? m.quantity
                  : -m.quantity
            return (
              <tr
                key={m.id}
                className="border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg"
              >
                <td className="px-5 py-3 text-text-muted">{formatDateTime(m.created_at)}</td>
                <td className="px-5 py-3 font-medium text-brand-slate">
                  {m.item?.name ?? 'Unknown item'}
                </td>
                <td className="px-5 py-3">
                  <Badge className={STOCK_MOVEMENT_TYPE_STYLES[m.movement_type]}>
                    {STOCK_MOVEMENT_TYPE_LABELS[m.movement_type]}
                  </Badge>
                </td>
                <td
                  className={`px-5 py-3 text-right font-semibold tabular-nums ${
                    signed >= 0 ? 'text-status-success' : 'text-status-danger'
                  }`}
                >
                  {signed >= 0 ? '+' : ''}
                  {signed} {m.item?.unit ?? ''}
                </td>
                <td className="px-5 py-3 text-text-muted">{m.performer?.full_name ?? '—'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
