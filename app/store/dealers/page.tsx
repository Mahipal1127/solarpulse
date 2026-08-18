import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getDealers } from '@/lib/store/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { DealerList } from '@/components/store/DealerList/DealerList'

export const dynamic = 'force-dynamic'

/** The dealer network — a simple contact/relationship log. */
export default async function DealersPage() {
  await requireDepartment(STORE_DEPARTMENT_SLUG)
  const dealers = await getDealers()

  return (
    <div className="space-y-6 p-6">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Dealers</h1>
          <p className="mt-1 text-sm text-text-muted">
            The dealer network — contacts and relationship status.
          </p>
        </div>
        <Link
          href="/store/dealers/new"
          className="shrink-0 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-orange"
        >
          Add dealer
        </Link>
      </header>

      <Card>
        <CardHeader title="Dealers" subtitle={`${dealers.length} tracked`} />
        <DealerList dealers={dealers} />
      </Card>
    </div>
  )
}
