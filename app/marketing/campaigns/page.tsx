import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { CampaignList } from '@/components/marketing/CampaignList'
import { getCampaigns } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'

export const dynamic = 'force-dynamic'

/**
 * The campaign register. RLS scopes it: an employee sees campaigns they manage, a
 * lead/CEO sees the department's. Cost per lead is the derived headline metric,
 * computed in the table from amount_spent and leads_generated.
 */
export default async function CampaignsPage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)

  const campaigns = await getCampaigns(user.organization_id)

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Campaigns</h1>
          <p className="mt-1 text-sm text-text-muted">
            Paid and organic pushes across social and search, with the cost of every lead they
            draw.
          </p>
        </div>
        {!readOnly && (
          <Link
            href="/marketing/campaigns/new"
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            New campaign
          </Link>
        )}
      </div>

      <CampaignList campaigns={campaigns} />
    </div>
  )
}
