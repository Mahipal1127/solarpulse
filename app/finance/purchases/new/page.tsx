import Link from 'next/link'
import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getPurchaseOrderOptions } from '@/lib/finance/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { PurchaseBillForm } from '@/components/finance/PurchaseBillForm'

export const dynamic = 'force-dynamic'

/**
 * Record a vendor bill. The PO picker is fed Distribution's purchase orders that Finance can
 * see (0007 grants the read); billing against one links them and pre-fills vendor + amount.
 * A read-only viewer (CEO) gets a notice; recording is a Finance-member action.
 */
export default async function NewPurchaseBillPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])

  if (!isFinanceMember(user)) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Record bill</h1>
        </header>
        <Card>
          <EmptyState
            title="Read-only"
            description="Bills are recorded by the Finance team. You are viewing this module read-only."
          />
        </Card>
      </div>
    )
  }

  const purchaseOrders = await getPurchaseOrderOptions()

  return (
    <div className="space-y-6 p-6">
      <header>
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Link href="/finance/purchases" className="hover:text-brand-gold">
            Purchases
          </Link>
          <span>/</span>
          <span>New bill</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-brand-slate">Record bill</h1>
      </header>

      <Card>
        <CardHeader title="Bill details" />
        <div className="px-5 py-4">
          <PurchaseBillForm purchaseOrders={purchaseOrders} />
        </div>
      </Card>
    </div>
  )
}
