import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { PurchaseOrderForm } from '@/components/distribution/PurchaseOrderForm/PurchaseOrderForm'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import type { Vendor } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function NewPurchaseOrderPage() {
  // Distribution only: Finance approves orders, it does not raise them.
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)) {
    redirect('/distribution/purchase-orders')
  }

  const supabase = await createSupabaseServerClient()

  // Active vendors only. A deactivated supplier stays on its historical orders but
  // should not be offered for a new one — create_purchase_order() refuses it too.
  const { data } = await supabase
    .from('vendors')
    .select('id, name, category')
    .eq('organization_id', user.organization_id)
    .eq('is_active', true)
    .order('name', { ascending: true })

  const vendors = (data ?? []) as Pick<Vendor, 'id' | 'name' | 'category'>[]

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/distribution/purchase-orders"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to purchase orders
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Raise a purchase order</h1>
        <p className="mt-1 text-sm text-text-muted">
          Save it as a draft to keep working, or submit it for Finance approval. Material cannot be
          ordered until Finance signs it off.
        </p>
      </div>

      <Card className="px-5 py-5">
        <PurchaseOrderForm mode="create" vendors={vendors} />
      </Card>
    </div>
  )
}
