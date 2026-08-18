import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { INVENTORY_CATEGORY_LABELS } from '@/lib/format'
import { isLowStock } from '@/lib/store/dashboard'
import type { InventoryStockLevel } from '@/lib/types'

/**
 * The inventory table. Reads InventoryStockLevel rows (the inventory_stock_levels VIEW), never
 * inventory_items — current_quantity is computed from the movement log, so this is the shape
 * that carries an accurate figure. Presentational and server-rendered: which rows arrive is
 * RLS's call (department-wide for any Store member), so there is no owner filter here.
 *
 * A low-stock row (quantity at/below its reorder threshold) is tinted and badged so the queue
 * reads at a glance. This is a flag only — nothing here raises a purchase order.
 */
export function InventoryList({ levels }: { levels: InventoryStockLevel[] }) {
  if (levels.length === 0) {
    return (
      <EmptyState
        title="No items yet"
        description="Add the first inventory item to start tracking stock."
      />
    )
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Item</th>
            <th className="px-5 py-3">Category</th>
            <th className="px-5 py-3 text-right">In stock</th>
            <th className="px-5 py-3 text-right">Reorder at</th>
            <th className="px-5 py-3">Rack</th>
            <th className="px-5 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {levels.map((level) => {
            const low = isLowStock(level)
            return (
              <tr
                key={level.inventory_item_id}
                className={`border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg ${
                  low ? 'bg-status-warning/5' : ''
                }`}
              >
                <td className="px-5 py-3">
                  <Link
                    href={`/store/inventory/${level.inventory_item_id}`}
                    className="font-medium text-brand-slate hover:text-brand-gold"
                  >
                    {level.name}
                  </Link>
                  {level.sku && <p className="mt-0.5 text-xs text-text-muted">{level.sku}</p>}
                </td>
                <td className="px-5 py-3 text-text-muted">
                  {INVENTORY_CATEGORY_LABELS[level.category] ?? level.category}
                </td>
                <td
                  className={`px-5 py-3 text-right font-semibold tabular-nums ${
                    low ? 'text-status-warning' : 'text-brand-slate'
                  }`}
                >
                  {level.current_quantity} {level.unit}
                </td>
                <td className="px-5 py-3 text-right tabular-nums text-text-muted">
                  {level.reorder_threshold != null ? `${level.reorder_threshold} ${level.unit}` : '—'}
                </td>
                <td className="px-5 py-3 text-text-muted">{level.rack_location ?? '—'}</td>
                <td className="px-5 py-3">
                  {low ? (
                    <Badge className="badge-warning">Low stock</Badge>
                  ) : (
                    <Badge className="badge-success">OK</Badge>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
