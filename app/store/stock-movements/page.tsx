import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getStockMovements } from '@/lib/store/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { StockMovementLog } from '@/components/store/StockMovementLog/StockMovementLog'

export const dynamic = 'force-dynamic'

/**
 * The full movement log — the audit trail behind every stock quantity in the module. Read-only
 * here; changes are made by logging a new movement, never by editing the past.
 */
export default async function StockMovementsPage() {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const movements = await getStockMovements({ limit: 200 })

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Stock movements</h1>
          <p className="mt-1 text-sm text-text-muted">
            The append-only ledger of every stock change. Newest first.
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/store/stock-movements/damaged"
            className="rounded-lg border border-border-subtle px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-card"
          >
            Log damaged
          </Link>
          <Link
            href="/store/stock-movements/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange"
          >
            Log movement
          </Link>
        </div>
      </header>

      <Card>
        <CardHeader title="Movement log" subtitle={`${movements.length} shown`} />
        <StockMovementLog movements={movements} />
      </Card>
    </div>
  )
}
