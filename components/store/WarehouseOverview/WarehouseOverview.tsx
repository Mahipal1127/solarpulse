import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { INVENTORY_CATEGORY_LABELS } from '@/lib/format'
import { isLowStock } from '@/lib/store/dashboard'
import type { RackGroup } from '@/lib/store/dashboard'

/**
 * Items grouped by rack location — a simple grouped table, not a bin map (scope: rack_location
 * is a free-text label). Each group is a rack; items with no rack fall under "Unassigned" so
 * they are visible rather than hidden. Reads the computed levels, so quantities are accurate.
 */
export function WarehouseOverview({ groups }: { groups: RackGroup[] }) {
  if (groups.length === 0) {
    return (
      <EmptyState
        title="Nothing to show"
        description="Add inventory items and give them a rack location to see them grouped here."
      />
    )
  }

  return (
    <div className="space-y-5">
      {groups.map((group) => (
        <div
          key={group.rack_location ?? '__unassigned__'}
          className="rounded-2xl border border-border-subtle bg-surface-card"
        >
          <div className="flex items-center justify-between border-b border-border-subtle px-5 py-3">
            <h3 className="text-sm font-semibold text-brand-slate">
              {group.rack_location ?? 'Unassigned'}
            </h3>
            <span className="text-xs text-text-muted">
              {group.items.length} item{group.items.length === 1 ? '' : 's'}
            </span>
          </div>
          <ul className="divide-y divide-border-subtle">
            {group.items.map((item) => {
              const low = isLowStock(item)
              return (
                <li
                  key={item.inventory_item_id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/store/inventory/${item.inventory_item_id}`}
                      className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                    >
                      {item.name}
                    </Link>
                    <p className="text-xs text-text-muted">
                      {INVENTORY_CATEGORY_LABELS[item.category] ?? item.category}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        low ? 'text-status-warning' : 'text-brand-slate'
                      }`}
                    >
                      {item.current_quantity} {item.unit}
                    </span>
                    {low && <Badge className="badge-warning">Low</Badge>}
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}
