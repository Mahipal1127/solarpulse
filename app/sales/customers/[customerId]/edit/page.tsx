import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { CustomerForm } from '@/components/sales/CustomerForm/CustomerForm'
import { getSalesEmployees } from '@/lib/sales/queries'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
import type { Customer } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Editing a customer's contact details.
 *
 * Contact fields only. The customer↔lead link is not editable here: it is
 * written by close_deal() together with the closure row, and a hand-made link
 * would produce a customer with a lead and no closure. The form and the service
 * both refuse it, from one schema.
 *
 * RLS decides which customers arrive — an executive's own rows only — so a
 * colleague's customer is the same 404 here as one that does not exist.
 */
export default async function EditCustomerPage(
  props: PageProps<'/sales/customers/[customerId]/edit'>
) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing to edit.
  if (isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)) redirect('/sales/customers')

  const { customerId } = await props.params
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('customers')
    .select(
      'id, organization_id, lead_id, name, phone, email, address, assigned_to, created_at, updated_at'
    )
    .eq('id', customerId)
    .maybeSingle()

  if (!data) notFound()
  const customer = data as Customer

  const canAssign = isSalesManager(user)
  const employees = canAssign ? await getSalesEmployees(user.organization_id) : []

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href={`/sales/customers/${customer.id}`}
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to {customer.name}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Edit customer</h1>
        <p className="mt-1 text-sm text-text-muted">
          Contact details only. Clear a field to remove it.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <CustomerForm
          mode="edit"
          customer={customer}
          employees={employees}
          canAssign={canAssign}
        />
      </Card>
    </div>
  )
}
