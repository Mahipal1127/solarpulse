import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { getCompanyDetails } from '@/lib/services/company-details'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { CompanyDetailsForm } from '@/components/hr/CompanyDetails/CompanyDetailsForm'

export const dynamic = 'force-dynamic'

/**
 * Company Details — the contact footer printed on every ID card (address, phone,
 * e-mail). SENSITIVE TIER: edited only by the HR lead / CEO, the same tier that
 * generates cards. A plain HR Executive gets a notice and no form; RLS (0023) and
 * the route's assertCanManage are the real controls, this omission is defence in
 * depth.
 */
export default async function CompanyDetailsPage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const lead = isHrLead(user)

  if (!lead) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Company Details</h1>
        </header>
        <Card>
          <EmptyState
            title="Restricted"
            description="The ID-card contact footer is edited only by the HR lead and CEO. Ask your HR lead if it needs a change."
          />
        </Card>
      </div>
    )
  }

  const details = await getCompanyDetails(user.organization_id)

  return (
    <div className="space-y-6 p-6 sm:p-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-brand-slate">Company Details</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          The contact footer printed on the bottom of every employee ID card. Editing it here
          changes what new cards show; regenerate an existing card to refresh its footer.
        </p>
      </header>

      <Card>
        <CardHeader title="ID card footer" subtitle="Address, phone and e-mail" />
        <div className="px-5 py-5">
          <CompanyDetailsForm details={details} />
        </div>
      </Card>
    </div>
  )
}
