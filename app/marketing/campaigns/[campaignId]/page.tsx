import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader, Badge, StatCard, ProgressBar, EmptyState } from '@/components/ui/primitives'
import { CampaignManageControl } from '@/components/marketing/CampaignManageControl'
import { getCampaignDetail } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import {
  formatDate,
  formatDateTime,
  formatCurrency,
  formatCostPerLead,
  CAMPAIGN_STATUS_STYLES,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_OBJECTIVE_LABELS,
  CAMPAIGN_PLATFORM_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * A campaign's detail — spend against budget, the leads it drew, the derived cost per
 * lead, and the manage controls (status + spend logging) for the team. The linked
 * lead_sources are the cross-module trace: each references a Sales lead by id only,
 * because Marketing has no read access to Sales' pipeline (§3.3). We show the origin,
 * not the lead's contents.
 */
export default async function CampaignDetailPage(
  props: PageProps<'/marketing/campaigns/[campaignId]'>
) {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)
  const { campaignId } = await props.params

  const campaign = await getCampaignDetail(campaignId)
  if (!campaign) notFound()

  const budget = campaign.budget_amount ?? 0
  const spendPct = budget > 0 ? (campaign.amount_spent / budget) * 100 : 0

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/marketing/campaigns" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to campaigns
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-brand-slate">{campaign.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-text-muted">
              <Badge className={CAMPAIGN_STATUS_STYLES[campaign.status]}>
                {CAMPAIGN_STATUS_LABELS[campaign.status]}
              </Badge>
              {campaign.platform && <span>{CAMPAIGN_PLATFORM_LABELS[campaign.platform]}</span>}
              {campaign.objective && (
                <span>· {CAMPAIGN_OBJECTIVE_LABELS[campaign.objective]}</span>
              )}
              {campaign.manager?.full_name && <span>· {campaign.manager.full_name}</span>}
            </p>
            {(campaign.start_date || campaign.end_date) && (
              <p className="mt-1 text-xs text-text-muted">
                {campaign.start_date ? formatDate(campaign.start_date) : '—'}
                {' → '}
                {campaign.end_date ? formatDate(campaign.end_date) : 'ongoing'}
              </p>
            )}
          </div>
          {!readOnly && (
            <Link
              href={`/marketing/campaigns/log-lead?campaign_id=${campaign.id}`}
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
            >
              Log new lead
            </Link>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Spent" value={formatCurrency(campaign.amount_spent)} />
        <StatCard
          label="Budget"
          value={budget > 0 ? formatCurrency(budget) : '—'}
          hint={budget > 0 ? `${Math.round(spendPct)}% used` : 'No budget set'}
        />
        <StatCard label="Leads generated" value={campaign.leads_generated} tone="brand" />
        <StatCard
          label="Cost per lead"
          value={formatCostPerLead(campaign.amount_spent, campaign.leads_generated)}
        />
      </div>

      {budget > 0 && (
        <Card className="px-5 py-4">
          <div className="mb-2 flex items-center justify-between text-xs text-text-muted">
            <span>Spend vs budget</span>
            <span className="tabular-nums">
              {formatCurrency(campaign.amount_spent)} / {formatCurrency(budget)}
            </span>
          </div>
          <ProgressBar value={spendPct} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title="Leads from this campaign"
              subtitle="Each lead was handed to Sales. Marketing tracks the origin, not the pipeline."
            />
            {campaign.lead_sources.length === 0 ? (
              <EmptyState
                title="No leads yet"
                description="Log a lead when this campaign draws an inquiry — it goes straight to Sales."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {campaign.lead_sources.map((s) => (
                  <li key={s.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-medium text-brand-slate">
                        {s.source_detail || 'Lead'}
                        {s.content_calendar_item_id && (
                          <Link
                            href={`/marketing/content-calendar/${s.content_calendar_item_id}`}
                            className="ml-2 text-xs font-normal text-text-muted underline decoration-dotted hover:text-brand-gold"
                          >
                            from content
                          </Link>
                        )}
                      </p>
                      <span className="text-xs text-text-muted">{formatDateTime(s.created_at)}</span>
                    </div>
                    <p className="mt-0.5 font-mono text-xs text-text-muted">
                      Sales lead · {s.lead_id.slice(0, 8)}…
                      {s.creator?.full_name && ` · logged by ${s.creator.full_name}`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          {!readOnly && (
            <Card className="p-5">
              <h2 className="mb-4 text-sm font-semibold text-brand-slate">Manage</h2>
              <CampaignManageControl
                campaignId={campaign.id}
                status={campaign.status}
                amountSpent={campaign.amount_spent}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
