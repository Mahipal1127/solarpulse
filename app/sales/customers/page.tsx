import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, StatCard } from '@/components/ui/primitives'
import { CustomerList, type CustomerRow } from '@/components/sales/CustomerList/CustomerList'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
import { formatCurrency } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * closures is the reverse side of deal_closures.customer_id, so it comes back as
 * an array even though close_deal() writes exactly one row per customer.
 */
const CUSTOMER_SELECT =
  'id, organization_id, lead_id, name, phone, email, address, assigned_to, created_at, updated_at, assignee:users!customers_assigned_to_fkey(full_name), closures:deal_closures(final_amount, closed_at)'

export default async function CustomersPage() {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)
  const seesTeam = isSalesManager(user) || user.roleName === 'CEO'

  const supabase = await createSupabaseServerClient()

  // Same rule as the leads page: no owner filter here. sales_exec_own_customers
  // returns only the caller's rows, so an executive sees their own customers
  // because the database says so, not because this query narrowed it.
  const { data } = await supabase
    .from('customers')
    .select(CUSTOMER_SELECT)
    .eq('organization_id', user.organization_id)
    .order('created_at', { ascending: false })
    .limit(500)

  const customers = (data ?? []) as unknown as CustomerRow[]

  const totalValue = customers.reduce(
    (sum, c) => sum + (c.closures?.[0] ? Number(c.closures[0].final_amount) : 0),
    0
  )
  const withoutClosure = customers.filter((c) => !c.closures?.[0]).length

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">
          {seesTeam ? 'Customers' : 'My Customers'}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Created automatically when a deal closes. Invoicing and payment tracking belong to
          Finance, not here.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Customers" value={customers.length} />
        <StatCard
          label="Closed Value"
          value={formatCurrency(totalValue)}
          tone="success"
          hint="Sum of closure amounts"
        />
        <StatCard
          label="No Closure Record"
          value={withoutClosure}
          hint="Entered directly, not via a won lead"
        />
      </div>

      <Card>
        <CustomerList
          customers={customers}
          showAssignee={seesTeam}
          emptyTitle="No customers yet"
          emptyDescription={
            readOnly
              ? 'The Sales department has not closed a deal yet.'
              : 'Closing a deal on a lead creates the customer record here automatically.'
          }
        />
      </Card>
    </div>
  )
}
