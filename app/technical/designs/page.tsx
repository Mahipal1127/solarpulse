import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/primitives'
import { DesignList, type DesignRow } from '@/components/technical/DesignList/DesignList'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import { DESIGN_WIP_STATUSES } from '@/lib/technical/constants'

export const dynamic = 'force-dynamic'

export default async function DesignsPage() {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  const lead = isTechnicalLead(user)

  const supabase = await createSupabaseServerClient()

  /**
   * No owner filter in the query. Which designs come back is RLS's decision — an
   * engineer sees their own, a lead and the CEO see the department's — and putting
   * the same rule here would mean maintaining it in two places.
   *
   * The lead's name arrives through the survey rather than directly: designs carry no
   * lead_id of their own, because a design belongs to a survey and the survey knows
   * whose roof it is.
   */
  const { data } = await supabase
    .from('designs')
    .select(
      `*,
       designer:users!designs_designed_by_fkey(full_name),
       survey:site_surveys(id, lead:leads(name))`
    )
    .order('created_at', { ascending: false })
    .limit(300)

  const designs = (data ?? []) as unknown as DesignRow[]

  const wip = designs.filter((d) => DESIGN_WIP_STATUSES.includes(d.status))
  const awaitingReview = designs.filter((d) => d.status === 'under_review')
  const approved = designs.filter((d) => d.status === 'approved')
  const sent = designs.filter((d) => d.status === 'sent_to_sales')

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Designs</h1>
        <p className="mt-1 text-sm text-text-muted">
          System sizing, the bill of quantities, and the drawings. Designs are recorded here and
          drawn in your own CAD tool — a design starts from a completed survey.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="In Progress" value={wip.length} hint="Draft or under review" />
        <StatCard
          label="Awaiting Review"
          value={awaitingReview.length}
          tone={awaitingReview.length > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Approved"
          value={approved.length}
          hint="Ready to hand to Sales"
          tone={approved.length > 0 ? 'success' : 'default'}
        />
        <StatCard label="Sent to Sales" value={sent.length} hint="Frozen — quoting from these" />
      </div>

      <DesignList
        designs={designs}
        currentUserId={user.id}
        showOwnerFilter={lead || user.roleName === 'CEO'}
      />
    </div>
  )
}
