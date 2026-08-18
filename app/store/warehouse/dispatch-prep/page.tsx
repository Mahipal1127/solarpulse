import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getDispatchPrepRows } from '@/lib/store/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { DispatchPrepList } from '@/components/store/DispatchPrepList/DispatchPrepList'

export const dynamic = 'force-dynamic'

/**
 * Dispatch preparation — a thin, READ-ONLY window onto Distribution's dispatches still in
 * 'preparing', so Store can ready the physical stock. Distribution (0007) owns dispatch end to
 * end; this page creates and mutates nothing. It is deliberately minimal until Distribution
 * defines the formal Store handoff contract (see lib/store/dashboard.ts).
 */
export default async function DispatchPrepPage() {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const rows = await getDispatchPrepRows()

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/store/warehouse" className="hover:text-brand-gold">
            Warehouse
          </Link>
          <span>/</span>
          <span>Dispatch prep</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">Dispatch preparation</h1>
        <p className="mt-1 text-sm text-text-muted">
          Dispatches Distribution is preparing. Ready the stock against these — they are created
          and managed in the Distribution module.
        </p>
      </header>

      <Card>
        <CardHeader title="Awaiting dispatch" subtitle={`${rows.length} being prepared`} />
        <DispatchPrepList rows={rows} />
      </Card>
    </div>
  )
}
