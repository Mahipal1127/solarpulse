import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { CampaignForm } from '@/components/marketing/CampaignForm'
import { getMarketingEmployees } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'

export const dynamic = 'force-dynamic'

export default async function NewCampaignPage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) redirect('/marketing/campaigns')

  const employees = await getMarketingEmployees(user.organization_id)

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/marketing/campaigns" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">New campaign</h1>
        <p className="mt-1 text-sm text-text-muted">
          Set the objective, platform and budget. Log spend and leads as the campaign runs.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <CampaignForm employees={employees} />
      </Card>
    </div>
  )
}
