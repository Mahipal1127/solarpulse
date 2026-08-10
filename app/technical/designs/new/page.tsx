import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { DesignForm } from '@/components/technical/DesignForm/DesignForm'
import { TECHNICAL_DEPARTMENT_SLUG } from '@/lib/services/technical'
import { formatDate } from '@/lib/format'
import type { SiteSurvey } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function NewDesignPage(props: PageProps<'/technical/designs/new'>) {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)

  // The CEO reads this module but does not write to it.
  if (isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)) redirect('/technical/designs')

  const { surveyId } = await props.searchParams
  const supabase = await createSupabaseServerClient()

  /**
   * No survey named, which happens when someone reaches this page from the sidebar
   * rather than from a survey's "Start Design" button. Offering the completed surveys
   * that have no design yet is more use than an error — it is the same question,
   * asked the other way round.
   */
  if (typeof surveyId !== 'string' || surveyId === '') {
    const [{ data: surveyData }, { data: designData }] = await Promise.all([
      supabase
        .from('site_surveys')
        .select('*, lead:leads(name)')
        .eq('status', 'completed')
        .order('updated_at', { ascending: false })
        .limit(100),
      supabase.from('designs').select('survey_id'),
    ])

    const designed = new Set(
      ((designData ?? []) as { survey_id: string }[]).map((row) => row.survey_id)
    )

    const candidates = ((surveyData ?? []) as unknown as (SiteSurvey & {
      lead: { name: string } | null
    })[]).filter((survey) => !designed.has(survey.id))

    return (
      <div className="space-y-6 p-6">
        <div>
          <Link href="/technical/designs" className="text-xs text-text-muted hover:text-brand-slate">
            ← Back to designs
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Start a design</h1>
          <p className="mt-1 text-sm text-text-muted">
            Every design is drawn from a completed survey. Pick the site you are designing for.
          </p>
        </div>

        <Card>
          <CardHeader
            title="Completed surveys without a design"
            subtitle="Measurements are settled, nothing designed yet"
          />
          {candidates.length === 0 ? (
            <EmptyState
              title="Nothing waiting to be designed"
              description="Every completed survey already has a design. A design needs a survey marked complete — measurements still being taken can still change."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {candidates.map((survey) => (
                <li key={survey.id}>
                  <Link
                    href={`/technical/designs/new?surveyId=${survey.id}`}
                    className="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors hover:bg-surface-bg"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-brand-slate">
                        {survey.lead?.name ?? 'No lead linked'}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        Surveyed {formatDate(survey.updated_at)}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-brand-slate">Design →</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    )
  }

  const [{ data: surveyRow }, { data: existingDesigns }] = await Promise.all([
    supabase
      .from('site_surveys')
      .select('*, lead:leads(name)')
      .eq('id', surveyId)
      .maybeSingle(),
    supabase.from('designs').select('id').eq('survey_id', surveyId).limit(1),
  ])

  // RLS decides. A survey outside this engineer's reach is the same as one that does
  // not exist, so send them to the list rather than confirming it is out there.
  if (!surveyRow) redirect('/technical/designs')

  const survey = surveyRow as unknown as SiteSurvey & { lead: { name: string } | null }

  // A revision is a new design, but two designs started in parallel is just two
  // competing BOQs. Send them to the one that exists and let them decide.
  const already = (existingDesigns ?? []) as { id: string }[]
  if (already.length > 0) redirect(`/technical/designs/${already[0].id}`)

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href={`/technical/surveys/${survey.id}`}
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to survey
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">
          Design for {survey.lead?.name ?? 'this site'}
        </h1>
        <p className="mt-1 text-sm text-text-muted">
          Every field is optional — open the record now and fill in the numbers as they settle. The
          layout and single line diagram are uploaded afterwards.
        </p>
      </div>

      {survey.status !== 'completed' && (
        <Card className="border-status-warning/30 bg-status-warning/5 px-5 py-4">
          <p className="text-sm text-status-warning">
            This survey is not marked complete, so a design cannot start from it yet — measurements
            still being taken can still change. Close the survey out first.
          </p>
          <Link
            href={`/technical/surveys/${survey.id}`}
            className="mt-3 inline-block text-sm font-semibold text-status-warning underline"
          >
            Open the survey
          </Link>
        </Card>
      )}

      {survey.status === 'completed' && (
        <Card className="max-w-3xl px-5 py-5">
          <DesignForm mode="create" surveyId={survey.id} />
        </Card>
      )}
    </div>
  )
}
