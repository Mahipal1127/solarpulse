import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getInventoryItemOptions } from '@/lib/store/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { StockMovementForm } from '@/components/store/StockMovementForm/StockMovementForm'

export const dynamic = 'force-dynamic'

/** searchParams values arrive as string | string[] | undefined; collapse to a single string. */
function asString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * Log a stock movement. A ?item= param (an item detail page's "Log movement" link may carry
 * it) pre-selects that item. A read-only viewer (CEO) sees a notice instead of the form.
 */
export default async function NewStockMovementPage(
  props: PageProps<'/store/stock-movements/new'>
) {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)

  if (isReadOnlyFor(user, STORE_DEPARTMENT_SLUG)) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Log movement</h1>
        </header>
        <Card>
          <EmptyState
            title="Read-only"
            description="Stock movements are logged by the Store team. You are viewing this module read-only."
          />
        </Card>
      </div>
    )
  }

  const searchParams = await props.searchParams
  const initialItemId = asString(searchParams.item)
  const items = await getInventoryItemOptions()

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/store/stock-movements" className="hover:text-brand-gold">
            Stock movements
          </Link>
          <span>/</span>
          <span>New</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">Log movement</h1>
      </header>

      <Card>
        <CardHeader title="Movement details" />
        <div className="px-5 py-4">
          <StockMovementForm items={items} initialItemId={initialItemId} />
        </div>
      </Card>
    </div>
  )
}
