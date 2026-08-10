import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { SurveyStatusTracker } from '@/components/technical/SurveyStatusTracker/SurveyStatusTracker'
import { PhotoSection, type PhotoRow } from '@/components/technical/SurveyMedia/PhotoSection'
import { ElectricityBillSection } from '@/components/technical/SurveyMedia/ElectricityBillSection'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import {
  formatDate,
  formatDateTime,
  formatCoordinates,
  formatSystemSize,
  isSurveyOverdue,
  isSurveyAwaitingSchedule,
  DESIGN_STATUS_STYLES,
  DESIGN_STATUS_LABELS,
} from '@/lib/format'
import type { SiteSurvey, Design } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function SurveyDetailPage(
  props: PageProps<'/technical/surveys/[surveyId]'>
) {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)
  const { surveyId } = await props.params

  const supabase = await createSupabaseServerClient()

  const { data: surveyData } = await supabase
    .from('site_surveys')
    .select(
      `*,
       engineer:users!site_surveys_assigned_engineer_id_fkey(full_name),
       creator:users!site_surveys_created_by_fkey(full_name),
       lead:leads(name, phone)`
    )
    .eq('id', surveyId)
    .maybeSingle()

  // RLS decides. A survey belonging to another engineer, or another tenant, comes
  // back as no row — the same 404 as one that does not exist.
  if (!surveyData) notFound()

  const survey = surveyData as unknown as SiteSurvey & {
    engineer: { full_name: string } | null
    creator: { full_name: string } | null
    lead: { name: string; phone: string | null } | null
  }

  const [{ data: photoData }, { data: designData }] = await Promise.all([
    supabase
      .from('survey_photos')
      .select('*, uploader:users!survey_photos_uploaded_by_fkey(full_name)')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: false }),

    supabase
      .from('designs')
      .select('*')
      .eq('survey_id', surveyId)
      .order('created_at', { ascending: false }),
  ])

  const photos = (photoData ?? []) as unknown as PhotoRow[]
  const designs = (designData ?? []) as Design[]

  /**
   * Mirrors assertCanWrite() in the service layer: a lead may work on anyone's
   * survey, an engineer only on their own. Not the enforcement — the service and RLS
   * both re-check — but it decides whether we show controls that would fail.
   *
   * Deliberately narrower than `readOnly`, which only distinguishes the department
   * from outside it. A Technical engineer looking at a colleague's survey is inside
   * the department and still cannot write to it.
   */
  const canOperate =
    !readOnly && (isTechnicalLead(user) || survey.assigned_engineer_id === user.id)

  const roof = survey.roof_measurements
  const hasRoofDetail =
    roof !== null &&
    (roof.usable_area_sqft !== undefined ||
      roof.tilt_degrees !== undefined ||
      roof.orientation !== undefined ||
      roof.shading_notes !== undefined)

  const overdue = isSurveyOverdue(survey)
  const awaiting = isSurveyAwaitingSchedule(survey)

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/technical/surveys" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to surveys
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-brand-slate">
              {survey.lead?.name ?? 'Survey with no lead linked'}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {survey.engineer?.full_name ?? 'Unassigned'}
              {' · '}
              {survey.scheduled_date
                ? `scheduled ${formatDateTime(survey.scheduled_date)}`
                : 'no date set'}
              {survey.lead?.phone ? ` · ${survey.lead.phone}` : ''}
            </p>
          </div>

          {canOperate && (
            <Link
              href={`/technical/surveys/${survey.id}/edit`}
              className="shrink-0 rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
            >
              Record findings
            </Link>
          )}
        </div>
      </div>

      {awaiting && (
        <Card className="border-status-warning/30 bg-status-warning/5 px-5 py-4">
          <p className="text-sm text-status-warning">
            Sales raised this request and it has no date yet. This is the handoff step that stalls
            most often — setting a date is what unblocks the customer.
          </p>
        </Card>
      )}

      {overdue && (
        <Card className="border-status-danger/30 bg-status-danger/5 px-5 py-4">
          <p className="text-sm text-status-danger">
            The scheduled slot has passed and the survey is not closed out. Either mark it complete
            or move the date.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Survey status" />
          <div className="px-5 py-4">
            <SurveyStatusTracker
              survey={survey}
              canOperate={canOperate}
              existingDesignId={designs[0]?.id ?? null}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Record" />
          <dl className="grid grid-cols-1 gap-4 px-5 py-4">
            <Field label="Location">{formatCoordinates(survey.gps_latitude, survey.gps_longitude)}</Field>
            <Field label="Survey type">
              {survey.is_drone_survey ? 'Drone-assisted' : 'On foot'}
            </Field>
            <Field label="Source">
              {survey.site_visit_request_id ? 'Sales site visit request' : 'Logged by Technical'}
            </Field>
            <Field label="Created">
              {formatDate(survey.created_at)}
              {survey.creator ? ` by ${survey.creator.full_name}` : ''}
            </Field>
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Roof measurements"
            subtitle="What the engineer measured on site"
          />
          {hasRoofDetail ? (
            <dl className="grid grid-cols-1 gap-4 px-5 py-4 sm:grid-cols-2">
              <Field label="Usable area">
                {roof?.usable_area_sqft !== undefined
                  ? `${roof.usable_area_sqft.toLocaleString('en-IN')} sq ft`
                  : 'Not recorded'}
              </Field>
              <Field label="Tilt">
                {roof?.tilt_degrees !== undefined ? `${roof.tilt_degrees}°` : 'Not recorded'}
              </Field>
              <Field label="Orientation">{roof?.orientation || 'Not recorded'}</Field>
              {roof?.shading_notes && (
                <div className="sm:col-span-2">
                  <Field label="Shading and obstructions">
                    <span className="whitespace-pre-wrap">{roof.shading_notes}</span>
                  </Field>
                </div>
              )}
            </dl>
          ) : (
            <EmptyState
              title="No measurements recorded"
              description={
                canOperate
                  ? 'Record the roof area, tilt, orientation and shading from the findings form.'
                  : 'The engineer has not recorded roof measurements for this survey.'
              }
            />
          )}
        </Card>

        <ElectricityBillSection survey={survey} readOnly={!canOperate} />
      </div>

      <PhotoSection surveyId={survey.id} photos={photos} readOnly={!canOperate} />

      <Card>
        <CardHeader
          title="Designs from this survey"
          subtitle="A design is a deliberate next step, not an automatic one"
        />
        {designs.length === 0 ? (
          <EmptyState
            title="No design yet"
            description={
              survey.status === 'completed'
                ? 'The survey is complete — use Start Design above when this roof is going ahead.'
                : 'Designs are drawn up once the survey is complete.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {designs.map((design) => (
              <li key={design.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/technical/designs/${design.id}`}
                      className="text-sm font-semibold text-brand-slate hover:text-brand-slate"
                    >
                      {formatSystemSize(design.system_size_kw)} system
                    </Link>
                    <Badge className={DESIGN_STATUS_STYLES[design.status]}>
                      {DESIGN_STATUS_LABELS[design.status]}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {design.panel_count ? `${design.panel_count} panels · ` : ''}
                    {formatDate(design.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {survey.notes && (
        <Card>
          <CardHeader title="Notes" />
          <p className="whitespace-pre-wrap px-5 py-4 text-sm text-text-muted">{survey.notes}</p>
        </Card>
      )}
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-brand-slate">{children}</dd>
    </div>
  )
}
