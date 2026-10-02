import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { CustomerForm } from '@/components/sales/CustomerForm/CustomerForm'
import { getSalesEmployees } from '@/lib/sales/queries'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'

/**
 * Adding a customer directly, with no won lead behind it.
 *
 * The ordinary path is unchanged: closing a deal on a lead writes the customer
 * inside close_deal(). This page is the customers table's documented
 * direct-entry allowance — a walk-in, a service-only client, or a site that
 * reached O&M/Rooftop before it ever reached Sales.
 */
export default async function NewCustomerPage() {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing for them here.
  if (isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)) redirect('/sales/customers')

  const canAssign = isSalesManager(user)
  const employees = canAssign ? await getSalesEmployees(user.organization_id) : []

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/sales/customers" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to customers
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Add customer</h1>
        <p className="mt-1 text-sm text-text-muted">
          {canAssign
            ? 'Created directly, with no won lead behind it. Leave the owner blank to keep it yourself.'
            : 'Created directly, with no won lead behind it, and owned by you.'}
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <CustomerForm employees={employees} canAssign={canAssign} />
      </Card>
    </div>
  )
}
