import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getInventoryItemOptions } from '@/lib/store/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { DamagedStockForm } from '@/components/store/DamagedStockForm/DamagedStockForm'

export const dynamic = 'force-dynamic'

/**
 * Record damaged stock. Its own page (not the plain movement form) because it writes the
 * damage detail and the stock decrement together in one transaction. Read-only viewers see a
 * notice.
 */
export default async function DamagedStockPage() {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)

  if (isReadOnlyFor(user, STORE_DEPARTMENT_SLUG)) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Damaged stock</h1>
        </header>
        <Card>
          <EmptyState
            title="Read-only"
            description="Damaged stock is recorded by the Store team. You are viewing this module read-only."
          />
        </Card>
      </div>
    )
  }

  const items = await getInventoryItemOptions()

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/store/stock-movements" className="hover:text-brand-gold">
            Stock movements
          </Link>
          <span>/</span>
          <span>Damaged</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">Record damaged stock</h1>
      </header>

      <Card>
        <CardHeader title="Damage details" />
        <div className="px-5 py-4">
          <DamagedStockForm items={items} organizationId={user.organization_id} />
        </div>
      </Card>
    </div>
  )
}
