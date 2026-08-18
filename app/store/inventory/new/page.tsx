import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { InventoryItemForm } from '@/components/store/InventoryItemForm/InventoryItemForm'

export const dynamic = 'force-dynamic'

/** Add a new inventory item type. A read-only viewer (CEO) is shown a notice, not the form. */
export default async function NewInventoryItemPage() {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)

  if (isReadOnlyFor(user, STORE_DEPARTMENT_SLUG)) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Add item</h1>
        </header>
        <Card>
          <EmptyState
            title="Read-only"
            description="Inventory items are added by the Store team. You are viewing this module read-only."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/store/inventory" className="hover:text-brand-gold">
            Inventory
          </Link>
          <span>/</span>
          <span>New</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">Add item</h1>
      </header>

      <Card>
        <CardHeader title="Item details" />
        <div className="px-5 py-4">
          <InventoryItemForm />
        </div>
      </Card>
    </div>
  )
}
