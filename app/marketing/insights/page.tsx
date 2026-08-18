import { requireDepartment } from '@/lib/auth/guards'
import { InsightFeed } from '@/components/marketing/InsightFeed'
import { getInsights } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'

export const dynamic = 'force-dynamic'

/**
 * The AI marketing insights feed. This module only READS these — the CEO module's AI
 * Marketing Officer writes them via the service-role client (there is no client insert
 * path, by design). The team and the CEO may acknowledge an insight; that single
 * UPDATE is the only write allowed here. Empty-state safe: if the AI system has not
 * run yet, the feed shows a calm empty state.
 */
export default async function InsightsPage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)

  const insights = await getInsights(user.organization_id)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">AI Insights</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          Recommendations from the AI Marketing Officer on your campaigns and content. Acknowledge
          the ones you&rsquo;ve actioned to keep the feed current.
        </p>
      </div>

      <InsightFeed insights={insights} />
    </div>
  )
}
