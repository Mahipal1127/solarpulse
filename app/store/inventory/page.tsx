import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getStockLevels } from '@/lib/store/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { InventoryList } from '@/components/store/InventoryList/InventoryList'

export const dynamic = 'force-dynamic'

/**
 * The inventory catalogue with live quantities. Reads the inventory_stock_levels view (via
 * getStockLevels), so the quantity shown is summed from the movement log and cannot drift.
 */
export default async function InventoryPage() {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const levels = await getStockLevels()

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Inventory</h1>
          <p className="mt-1 text-sm text-text-muted">
            Every item and its live stock level, computed from the movement log.
          </p>
        </div>
        <Link
          href="/store/inventory/new"
          className="shrink-0 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange"
        >
          Add item
        </Link>
      </header>

      <Card>
        <CardHeader title="Items" subtitle={`${levels.length} tracked`} />
        <InventoryList levels={levels} />
      </Card>
    </div>
  )
}
