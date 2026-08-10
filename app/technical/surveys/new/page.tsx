import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import {
  SurveyForm,
  type EngineerOption,
  type LeadOption,
  type VisitRequestOption,
} from '@/components/technical/SurveyForm/SurveyForm'
import { TECHNICAL_DEPARTMENT_SLUG } from '@/lib/services/technical'

export const dynamic = 'force-dynamic'

export default async function NewSurveyPage(props: PageProps<'/technical/surveys/new'>) {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)

  // The CEO reads this module but does not write to it. Sending them back rather
  // than rendering a form whose POST the route guard would refuse anyway.
  if (isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)) redirect('/technical/surveys')

  const { visitRequestId } = await props.searchParams

  const supabase = await createSupabaseServerClient()

  const [{ data: engineerData }, { data: requestData }, { data: takenData }] = await Promise.all([
    supabase
      .from('users')
      .select('id, full_name')
      .eq('organization_id', user.organization_id)
      .eq('department_id', user.department_id)
      .eq('is_active', true)
      .order('full_name', { ascending: true }),

    /**
     * The handoff queue. 'requested' only: a request already marked 'scheduled' has
     * been picked up, and 'completed'/'cancelled' are finished with. RLS narrows this
     * further to requests Technical is allowed to see at all.
     */
    supabase
      .from('site_visit_requests')
      .select('id, lead_id, preferred_date, notes, lead:leads(name)')
      .eq('status', 'requested')
      .order('created_at', { ascending: true })
      .limit(200),

    // Requests that already became a survey. The unique constraint on
    // site_visit_request_id would reject a second conversion with a 409 anyway;
    // this keeps them out of the picker so nobody tries.
    supabase.from('site_surveys').select('site_visit_request_id').not('site_visit_request_id', 'is', null),
  ])

  const engineers = (engineerData ?? []) as EngineerOption[]

  const taken = new Set(
    ((takenData ?? []) as { site_visit_request_id: string | null }[])
      .map((row) => row.site_visit_request_id)
      .filter((id): id is string => id !== null)
  )

  const rawRequests = (requestData ?? []) as unknown as {
    id: string
    lead_id: string
    preferred_date: string | null
    notes: string | null
    lead: { name: string } | null
  }[]

  const visitRequests: VisitRequestOption[] = rawRequests
    .filter((request) => !taken.has(request.id))
    .map((request) => ({
      id: request.id,
      lead_id: request.lead_id,
      lead_name: request.lead?.name ?? 'Unnamed lead',
      preferred_date: request.preferred_date,
      notes: request.notes,
    }))

  /**
   * Leads for the standalone case, derived from the requests above rather than
   * queried separately — and that is a real constraint, not a shortcut.
   *
   * Technical's policy on `leads` (0008) grants select only where a survey or a site
   * visit request already exists for that lead. There is no query this module can run
   * that returns the whole customer book, so a standalone survey can only be attached
   * to a lead Sales has already routed here. The form says as much rather than
   * offering an empty dropdown with no explanation.
   */
  const leads: LeadOption[] = Array.from(
    new Map(visitRequests.map((r) => [r.lead_id, { id: r.lead_id, name: r.lead_name }])).values()
  ).sort((a, b) => a.name.localeCompare(b.name))

  const preset =
    typeof visitRequestId === 'string' && visitRequests.some((r) => r.id === visitRequestId)
      ? visitRequestId
      : undefined

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/technical/surveys" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to surveys
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Log a survey</h1>
        <p className="mt-1 text-sm text-text-muted">
          Pick up a Sales site visit request, or record a survey Technical arranged itself. The
          findings — roof, location, bill — are captured afterwards, on the survey itself.
        </p>
      </div>

      {visitRequests.length === 0 && (
        <Card className="border-border-subtle bg-surface-bg px-5 py-4">
          <p className="text-sm text-text-muted">
            No Sales requests are waiting. You can still log a survey directly, though a lead can
            only be linked once Sales has raised a request for it — Technical deliberately cannot
            read the whole customer book.
          </p>
        </Card>
      )}

      <Card className="max-w-3xl px-5 py-5">
        <SurveyForm
          engineers={engineers}
          leads={leads}
          visitRequests={visitRequests}
          currentUserId={user.id}
          presetVisitRequestId={preset}
        />
      </Card>
    </div>
  )
}
