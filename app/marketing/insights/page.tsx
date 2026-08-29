import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { InsightFeed } from '@/components/marketing/InsightFeed'
import { InstagramAuditPanel } from '@/components/marketing/InstagramAuditPanel'
import { getInsights } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { listConnectedAccounts, listAudits, countPosts } from '@/lib/services/instagram'
import type { InstagramAudit } from '@/lib/instagram/types'

export const dynamic = 'force-dynamic'

/**
 * AI Insights — two things that both read the same way and are written very differently.
 *
 * The Instagram audit (top) is generated in this module: the team connects a handle, collects
 * its grid with the local tool, and this page's "Generate audit" computes the figures and asks
 * the AI to phrase them. Writes go through /api/instagram/*.
 *
 * The insight feed (below) is written elsewhere — the CEO module's AI Marketing Officer inserts
 * those via the service-role client, and this module only reads them and lets the team
 * acknowledge one. Both are empty-state safe: nothing connected and nothing run renders calmly
 * rather than erroring.
 *
 * The CEO sees both and writes neither, which `isReadOnlyFor` decides here and every
 * /api/instagram route re-checks — the frontend flag is a courtesy, the route guard is the
 * enforcement.
 */
export default async function InsightsPage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)

  const [insights, accounts] = await Promise.all([
    getInsights(user.organization_id),
    listConnectedAccounts(),
  ])

  // Audits and stored-post counts for every connected account, so switching between handles is
  // instant and needs no extra route. Most orgs connect one; the schema allows a few, and a few
  // small queries in parallel is cheaper than a round trip per click.
  const perAccount = await Promise.all(
    accounts.map(async (account) => ({
      id: account.id,
      audits: await listAudits(account.id),
      posts: await countPosts(account.id),
    }))
  )

  const auditsByAccount: Record<string, InstagramAudit[]> = {}
  const storedPostsByAccount: Record<string, number> = {}
  for (const entry of perAccount) {
    auditsByAccount[entry.id] = entry.audits
    storedPostsByAccount[entry.id] = entry.posts
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">AI Insights</h1>
        <p className="mt-1 max-w-2xl text-sm text-text-muted">
          An AI audit of your Instagram presence, and recommendations from the AI Marketing
          Officer on your campaigns and content.
        </p>
      </div>

      <InstagramAuditPanel
        accounts={accounts}
        auditsByAccount={auditsByAccount}
        storedPostsByAccount={storedPostsByAccount}
        readOnly={isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)}
      />

      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">
          Marketing Officer feed
        </h2>
        <p className="mt-1 max-w-2xl text-xs text-text-muted">
          Acknowledge the ones you&rsquo;ve actioned to keep the feed current.
        </p>
        <div className="mt-3">
          <InsightFeed insights={insights} />
        </div>
      </div>
    </div>
  )
}
