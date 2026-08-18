import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { InstallationForm } from '@/components/om/InstallationForm/InstallationForm'
import { getOMEmployees } from '@/lib/om/dashboard'
import { getCustomerOptions, getConvertibleDeals } from '@/lib/om/queries'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'

export const dynamic = 'force-dynamic'

export default async function NewInstallationPage() {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing for them here.
  if (isReadOnlyFor(user, OM_DEPARTMENT_SLUG)) redirect('/om/installations')

  const [customers, deals, teamLeads] = await Promise.all([
    getCustomerOptions(user.organization_id),
    getConvertibleDeals(user.organization_id),
    getOMEmployees(user.organization_id),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/om/installations"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to installations
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">New installation</h1>
        <p className="mt-1 text-sm text-text-muted">
          Convert a closed deal, or log a standalone installation. Either way it starts as
          Assigned — move it forward from the installation page.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <InstallationForm customers={customers} deals={deals} teamLeads={teamLeads} />
      </Card>
    </div>
  )
}
