import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/primitives'
import { SurveyList, type SurveyRow } from '@/components/technical/SurveyList/SurveyList'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import { isSurveyAwaitingSchedule, isSurveyOverdue } from '@/lib/format'
import { SURVEY_OPEN_STATUSES } from '@/lib/technical/constants'

export const dynamic = 'force-dynamic'

export default async function SurveysPage() {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)
  const lead = isTechnicalLead(user)

  const supabase = await createSupabaseServerClient()

  /**
   * No .eq('assigned_engineer_id', ...) here, deliberately. Which surveys come back
   * is RLS's decision: an engineer sees their own, a lead and the CEO see the whole
   * department's. Filtering in this query would put the same rule in a second place,
   * and the copy in application code is the one that drifts.
   */
  const { data } = await supabase
    .from('site_surveys')
    .select(
      '*, engineer:users!site_surveys_assigned_engineer_id_fkey(full_name), lead:leads(name)'
    )
    .order('created_at', { ascending: false })
    .limit(300)

  const surveys = (data ?? []) as unknown as SurveyRow[]

  const open = surveys.filter((s) => SURVEY_OPEN_STATUSES.includes(s.status))
  const awaitingSchedule = surveys.filter(isSurveyAwaitingSchedule)
  const overdue = surveys.filter(isSurveyOverdue)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Site Surveys</h1>
        <p className="mt-1 text-sm text-text-muted">
          What the roof actually looks like. Surveys arrive from a Sales site visit request, or get
          logged here directly.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={open.length} hint="Assigned or in progress" />
        <StatCard
          label="Needs a Date"
          value={awaitingSchedule.length}
          tone={awaitingSchedule.length > 0 ? 'warning' : 'default'}
          hint="Sales asked, nobody has scheduled it"
        />
        <StatCard
          label="Overdue"
          value={overdue.length}
          tone={overdue.length > 0 ? 'danger' : 'default'}
          hint="Scheduled slot has passed"
        />
        <StatCard
          label="Completed"
          value={surveys.filter((s) => s.status === 'completed').length}
        />
      </div>

      <SurveyList
        surveys={surveys}
        currentUserId={user.id}
        readOnly={readOnly}
        // Only worth offering to someone whose list contains other people's work.
        showOwnerFilter={lead || user.roleName === 'CEO'}
      />
    </div>
  )
}
