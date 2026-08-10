import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { LeadForm } from '@/components/sales/LeadForm/LeadForm'
import { getSalesEmployees } from '@/lib/sales/queries'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'

export default async function NewLeadPage() {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing for them here.
  if (isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)) redirect('/sales/leads')

  const canAssign = isSalesManager(user)
  const employees = canAssign ? await getSalesEmployees(user.organization_id) : []

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/sales/leads" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to leads
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Add lead</h1>
        <p className="mt-1 text-sm text-text-muted">
          {canAssign
            ? 'Enters the pipeline as New. Leave the owner blank to keep it yourself.'
            : 'Enters the pipeline as New, assigned to you.'}
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <LeadForm mode="create" employees={employees} canAssign={canAssign} />
      </Card>
    </div>
  )
}
