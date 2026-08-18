import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getRackGroups } from '@/lib/store/dashboard'
import { WarehouseOverview } from '@/components/store/WarehouseOverview/WarehouseOverview'

export const dynamic = 'force-dynamic'

/**
 * Warehouse rack overview — inventory grouped by its rack_location label. A simple grouped
 * table per the scope (rack location is a free-text field, not a 3D bin map).
 */
export default async function WarehousePage() {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const groups = await getRackGroups()

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Warehouse</h1>
          <p className="mt-1 text-sm text-text-muted">
            Inventory grouped by rack location. Set an item&apos;s rack on its detail to move it
            between groups.
          </p>
        </div>
        <Link
          href="/store/warehouse/dispatch-prep"
          className="shrink-0 rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-card"
        >
          Dispatch prep →
        </Link>
      </header>

      <WarehouseOverview groups={groups} />
    </div>
  )
}
