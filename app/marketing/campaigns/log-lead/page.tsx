import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { LeadFromCampaignForm } from '@/components/marketing/LeadFromCampaignForm'
import { getCampaignOptions, getContentItemOptions } from '@/lib/marketing/queries'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'

export const dynamic = 'force-dynamic'

/**
 * The lead-handoff page. Reached from a campaign's "Log new lead" or a post's "Log
 * lead from this" (which pass campaign_id / content_calendar_item_id), or from the nav
 * with neither pre-set. The origin pickers offer only what RLS lets the caller
 * reference. The CEO's read-only view has nothing to do here.
 */
export default async function LogLeadPage(props: PageProps<'/marketing/campaigns/log-lead'>) {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) redirect('/marketing/campaigns')

  const { campaign_id, content_calendar_item_id } = await props.searchParams

  const [campaigns, contentItems] = await Promise.all([
    getCampaignOptions(user.organization_id),
    getContentItemOptions(user.organization_id),
  ])

  const initialCampaignId = typeof campaign_id === 'string' ? campaign_id : undefined
  const initialContentItemId =
    typeof content_calendar_item_id === 'string' ? content_calendar_item_id : undefined

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/marketing/campaigns" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to campaigns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Log a new lead</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Capture an inquiry a campaign or post drew in and hand it straight to Sales. Tie it to its
          origin so the campaign&rsquo;s cost per lead stays honest.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <LeadFromCampaignForm
          campaigns={campaigns}
          contentItems={contentItems}
          initialCampaignId={initialCampaignId}
          initialContentItemId={initialContentItemId}
        />
      </Card>
    </div>
  )
}
