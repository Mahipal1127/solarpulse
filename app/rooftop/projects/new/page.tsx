import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader } from '@/components/ui/primitives'
import { RooftopProjectForm } from '@/components/rooftop/RooftopProjectForm'
import { getCustomerOptions } from '@/lib/rooftop/queries'
import { ROOFTOP_DEPARTMENT_SLUG } from '@/lib/services/rooftop'

export const dynamic = 'force-dynamic'

/**
 * Adding a customer site to the monitoring board.
 *
 * The CEO's access to this module is read-only; there is nothing for them to
 * add, so they are bounced back to the list the way every other module does.
 */
export default async function NewRooftopProjectPage() {
  const user = await requireDepartment(ROOFTOP_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, ROOFTOP_DEPARTMENT_SLUG)) {
    redirect('/rooftop/projects')
  }

  const customers = await getCustomerOptions(user.organization_id)

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Add a site</h1>
        <p className="mt-1 text-sm text-text-muted">
          A new site starts live — it enters the monitoring board the moment it is created.
        </p>
      </header>

      <Card>
        <CardHeader title="Site details" subtitle="The customer and where the work is happening" />
        <div className="p-5 pt-0">
          {customers.length === 0 ? (
            <p className="rounded-lg bg-surface-bg px-4 py-3 text-sm text-text-muted">
              There are no customers in this organization yet. A customer is created by Sales when
              a lead is won — add one there first, then come back.
            </p>
          ) : (
            <RooftopProjectForm customers={customers} />
          )}
        </div>
      </Card>
    </div>
  )
}
