import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getStockLevel, getStockMovements, isLowStock } from '@/lib/store/dashboard'
import { Card, CardHeader, StatCard } from '@/components/ui/primitives'
import { StockMovementLog } from '@/components/store/StockMovementLog/StockMovementLog'
import { INVENTORY_CATEGORY_LABELS } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * An item's detail: its live level (from the view) plus the full movement history that
 * produced it. The quantity headline is never stored — it is the running total of the log
 * shown below it, which is exactly why the two always agree.
 */
export default async function InventoryItemPage(props: PageProps<'/store/inventory/[itemId]'>) {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const { itemId } = await props.params

  const level = await getStockLevel(itemId)
  if (!level) notFound()

  const movements = await getStockMovements({ itemId, limit: 200 })
  const low = isLowStock(level)

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/store/inventory" className="hover:text-brand-gold">
            Inventory
          </Link>
          <span>/</span>
          <span>{level.name}</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">{level.name}</h1>
        <p className="mt-1 text-sm text-text-muted">
          {INVENTORY_CATEGORY_LABELS[level.category] ?? level.category}
          {level.sku ? ` · ${level.sku}` : ''}
          {level.rack_location ? ` · ${level.rack_location}` : ''}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="In stock"
          value={`${level.current_quantity} ${level.unit}`}
          tone={low ? 'warning' : 'brand'}
          hint={low ? 'At or below reorder threshold' : undefined}
        />
        <StatCard
          label="Reorder at"
          value={level.reorder_threshold != null ? `${level.reorder_threshold} ${level.unit}` : '—'}
        />
        <StatCard label="Movements" value={movements.length} />
      </div>

      <Card>
        <CardHeader
          title="Movement history"
          subtitle="Every change to this item's stock, newest first."
          action={
            <Link
              href="/store/stock-movements/new"
              className="text-xs font-medium text-brand-slate hover:text-brand-gold"
            >
              Log movement →
            </Link>
          }
        />
        <StockMovementLog
          movements={movements}
          emptyTitle="No movements yet"
          emptyDescription="Log a Stock In to record the opening quantity for this item."
        />
      </Card>
    </div>
  )
}
