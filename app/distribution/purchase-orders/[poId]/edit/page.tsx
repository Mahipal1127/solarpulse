import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { PurchaseOrderForm } from '@/components/distribution/PurchaseOrderForm/PurchaseOrderForm'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import type { Vendor, PurchaseOrder, PurchaseOrderItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EditPurchaseOrderPage(
  props: PageProps<'/distribution/purchase-orders/[poId]/edit'>
) {
  // Distribution only. Finance approves orders; it does not edit them.
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const { poId } = await props.params

  if (isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)) {
    redirect(`/distribution/purchase-orders/${poId}`)
  }

  const supabase = await createSupabaseServerClient()

  const [{ data: poData }, { data: itemData }, { data: vendorData }] = await Promise.all([
    supabase.from('purchase_orders').select('*').eq('id', poId).maybeSingle(),
    supabase
      .from('purchase_order_items')
      .select('*')
      .eq('purchase_order_id', poId)
      .order('created_at', { ascending: true }),
    supabase
      .from('vendors')
      .select('id, name, category')
      .eq('organization_id', user.organization_id)
      .eq('is_active', true)
      .order('name', { ascending: true }),
  ])

  if (!poData) notFound()
  const po = poData as PurchaseOrder
  const items = (itemData ?? []) as PurchaseOrderItem[]
  const vendors = (vendorData ?? []) as Pick<Vendor, 'id' | 'name' | 'category'>[]

  /**
   * Only a draft is fully editable. Once an order has been put to Finance, the
   * vendor and the line items behind the approved amount are frozen — the service
   * layer and replace_purchase_order_items() both refuse to move them, so sending
   * someone to a form that cannot save its main fields would be a dead end.
   *
   * The delivery date and notes are still correctable after approval, which the
   * detail page handles; this full form is for drafts.
   */
  if (po.status !== 'draft') redirect(`/distribution/purchase-orders/${poId}`)

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href={`/distribution/purchase-orders/${poId}`}
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to {po.po_number}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Edit {po.po_number}</h1>
        <p className="mt-1 text-sm text-text-muted">
          Still a draft, so the vendor and line items can change. Submit it for approval from the
          order page when it is ready.
        </p>
      </div>

      <Card className="px-5 py-5">
        <PurchaseOrderForm mode="edit" vendors={vendors} purchaseOrder={po} items={items} />
      </Card>
    </div>
  )
}
