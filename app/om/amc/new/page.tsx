import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { AMCForm } from '@/components/om/AMCTracker/AMCForm'
import { getOMEmployees } from '@/lib/om/dashboard'
import { getCustomerOptions, getInstallationOptions } from '@/lib/om/queries'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'

export const dynamic = 'force-dynamic'

export default async function NewAMCPage() {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)

  if (isReadOnlyFor(user, OM_DEPARTMENT_SLUG)) redirect('/om/amc')

  const [customers, installations, engineers] = await Promise.all([
    getCustomerOptions(user.organization_id),
    getInstallationOptions(user.organization_id),
    getOMEmployees(user.organization_id),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/om/amc" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to AMC
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">New AMC contract</h1>
        <p className="mt-1 text-sm text-text-muted">
          Opens as Active. Schedule visits against it from the contract page — expiry is worked out
          from the end date, nothing to set.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <AMCForm customers={customers} installations={installations} engineers={engineers} />
      </Card>
    </div>
  )
}
