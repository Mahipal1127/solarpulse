import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { SurveyEditForm } from '@/components/technical/SurveyForm/SurveyEditForm'
import type { EngineerOption } from '@/components/technical/SurveyForm/SurveyForm'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import type { SiteSurvey } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function EditSurveyPage(
  props: PageProps<'/technical/surveys/[surveyId]/edit'>
) {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  const { surveyId } = await props.params

  // The CEO reads this module but does not write to it.
  if (isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)) {
    redirect(`/technical/surveys/${surveyId}`)
  }

  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('site_surveys')
    .select('*')
    .eq('id', surveyId)
    .maybeSingle()

  if (!data) notFound()
  const survey = data as SiteSurvey

  const lead = isTechnicalLead(user)

  // Mirrors assertCanWrite/the engineer_own_surveys policy: an engineer may only
  // edit their own survey. Sending them back to read it rather than rendering a
  // form whose PATCH the service layer and RLS would both refuse.
  if (!lead && survey.assigned_engineer_id !== user.id) {
    redirect(`/technical/surveys/${surveyId}`)
  }

  /**
   * A lead may hand the survey to anyone in the department; an engineer may not,
   * per assertCanAssignTo(). So a non-lead gets a dropdown containing only
   * themselves — offering colleagues would be offering a save that comes back 403.
   */
  let engineers: EngineerOption[] = [{ id: user.id, full_name: user.full_name }]

  if (lead) {
    const { data: engineerData } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('organization_id', user.organization_id)
      .eq('department_id', user.department_id)
      .eq('is_active', true)
      .order('full_name', { ascending: true })

    const loaded = (engineerData ?? []) as EngineerOption[]
    if (loaded.length > 0) engineers = loaded
  }

  /**
   * The currently assigned engineer might not be in the list — a lead editing a
   * survey held by someone since deactivated, or an engineer who is not themselves
   * the assignee. Without this the select would silently fall to its first option
   * and a save would quietly reassign the survey.
   */
  if (!engineers.some((e) => e.id === survey.assigned_engineer_id)) {
    const { data: assignee } = await supabase
      .from('users')
      .select('id, full_name')
      .eq('id', survey.assigned_engineer_id)
      .maybeSingle()

    if (assignee) engineers = [assignee as EngineerOption, ...engineers]
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href={`/technical/surveys/${surveyId}`}
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to survey
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Record findings</h1>
        <p className="mt-1 text-sm text-text-muted">
          What you measured on site. Photos and the electricity bill are uploaded from the survey
          page itself, and the status is moved from there too.
        </p>
      </div>

      {survey.status === 'completed' && (
        <Card className="border-border-subtle bg-surface-bg px-5 py-4">
          <p className="text-sm text-text-muted">
            This survey is already marked complete. Measurements can still be corrected — closing
            out on site and typing up the numbers afterwards is normal — but the status itself no
            longer moves.
          </p>
        </Card>
      )}

      {survey.status === 'cancelled' && (
        <Card className="border-status-danger/30 bg-status-danger/5 px-5 py-4">
          <p className="text-sm text-status-danger">
            This survey was cancelled. Anything saved here is a correction to a record nobody is
            working from — if the site is going ahead after all, log a new survey.
          </p>
        </Card>
      )}

      <Card className="max-w-3xl px-5 py-5">
        <SurveyEditForm survey={survey} engineers={engineers} />
      </Card>
    </div>
  )
}
