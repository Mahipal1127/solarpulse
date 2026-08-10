import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { DesignStatusTracker } from '@/components/technical/DesignStatusTracker/DesignStatusTracker'
import { DesignFileSection } from '@/components/technical/DesignFiles/DesignFileSection'
import {
  GenerationReportSection,
  type ReportRow,
} from '@/components/technical/GenerationReport/GenerationReportSection'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import { formatDate, formatDateTime, formatSystemSize } from '@/lib/format'
import type { Design, SiteSurvey } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DesignDetailPage(
  props: PageProps<'/technical/designs/[designId]'>
) {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)
  const { designId } = await props.params

  const supabase = await createSupabaseServerClient()

  const { data: designData } = await supabase
    .from('designs')
    .select(
      `*,
       designer:users!designs_designed_by_fkey(full_name),
       survey:site_surveys(
         id, status, assigned_engineer_id, gps_latitude, gps_longitude,
         electricity_bill_avg_units, roof_measurements,
         lead:leads(name, phone)
       )`
    )
    .eq('id', designId)
    .maybeSingle()

  // RLS decides. A design outside the caller's reach comes back as no row — the same
  // 404 as one that does not exist, which is deliberate.
  if (!designData) notFound()

  const design = designData as unknown as Design & {
    designer: { full_name: string } | null
    survey:
      | (Pick<
          SiteSurvey,
          | 'id'
          | 'status'
          | 'assigned_engineer_id'
          | 'gps_latitude'
          | 'gps_longitude'
          | 'electricity_bill_avg_units'
          | 'roof_measurements'
        > & { lead: { name: string; phone: string | null } | null })
      | null
  }

  const { data: reportData } = await supabase
    .from('generation_reports')
    .select('*, generator:users!generation_reports_generated_by_fkey(full_name)')
    .eq('design_id', designId)
    .order('created_at', { ascending: false })

  const reports = (reportData ?? []) as unknown as ReportRow[]

  /**
   * Mirrors the engineer_own_designs policy: the design's author *or* the engineer
   * who ran the survey, because a Design Engineer often works from someone else's
   * survey and scoping to either one alone would lock out the other.
   */
  const mayEdit =
    !readOnly &&
    (isTechnicalLead(user) ||
      design.designed_by === user.id ||
      design.survey?.assigned_engineer_id === user.id)

  /**
   * A design that has gone to Sales is frozen: a quotation may already rest on its
   * figures, so revising them underneath would leave Sales quoting a system that no
   * longer exists. The service layer refuses the write either way — this keeps the
   * page from offering it.
   */
  const frozen = design.status === 'sent_to_sales'
  const canOperate = mayEdit && !frozen

  const boq = design.boq_data ?? []
  const roof = design.survey?.roof_measurements ?? null

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/technical/designs" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to designs
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-brand-slate">
              {design.survey?.lead?.name ?? 'Design with no lead linked'}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {formatSystemSize(design.system_size_kw)}
              {design.panel_count ? ` · ${design.panel_count} panels` : ''}
              {design.panel_wattage ? ` × ${design.panel_wattage} W` : ''}
              {' · '}
              {design.designer?.full_name ?? 'Unknown designer'}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            {design.survey && (
              <Link
                href={`/technical/surveys/${design.survey.id}`}
                className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                View survey
              </Link>
            )}
            {canOperate && (
              <Link
                href={`/technical/designs/${design.id}/edit`}
                className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                Edit design
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Design status" />
          <div className="px-5 py-4">
            <DesignStatusTracker design={design} canOperate={mayEdit} />
          </div>
        </Card>

        <Card>
          <CardHeader title="From the survey" subtitle="What this design is based on" />
          <dl className="grid grid-cols-1 gap-4 px-5 py-4">
            <Field label="Usable roof area">
              {roof?.usable_area_sqft !== undefined
                ? `${roof.usable_area_sqft.toLocaleString('en-IN')} sq ft`
                : 'Not recorded'}
            </Field>
            <Field label="Orientation">{roof?.orientation || 'Not recorded'}</Field>
            <Field label="Average monthly use">
              {design.survey?.electricity_bill_avg_units
                ? `${Number(design.survey.electricity_bill_avg_units).toLocaleString('en-IN')} kWh`
                : 'Not recorded'}
            </Field>
            <Field label="Created">{formatDate(design.created_at)}</Field>
            <Field label="Last changed">{formatDateTime(design.updated_at)}</Field>
          </dl>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Bill of quantities"
            subtitle="No prices — costing is Sales', stock is Store's"
          />
          {boq.length === 0 ? (
            <EmptyState
              title="No bill of quantities yet"
              description={
                canOperate
                  ? 'Add the items this system needs from the edit form.'
                  : 'No BOQ has been recorded for this design.'
              }
            />
          ) : (
            <div className="overflow-x-auto px-5 py-4">
              <table className="min-w-full text-left">
                <thead>
                  <tr className="border-b border-border-subtle">
                    <th className="pb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Item
                    </th>
                    <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Qty
                    </th>
                    <th className="pb-2 pl-3 text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Unit
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {boq.map((line, index) => (
                    <tr key={`${line.item}-${index}`} className="border-b border-border-subtle last:border-0">
                      <td className="py-2.5 text-sm text-brand-slate">{line.item}</td>
                      <td className="py-2.5 text-right text-sm font-medium text-brand-slate">
                        {Number(line.qty).toLocaleString('en-IN')}
                      </td>
                      <td className="py-2.5 pl-3 text-sm text-text-muted">{line.unit}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Inverter" />
          {design.inverter_spec ? (
            <p className="whitespace-pre-wrap px-5 py-4 text-sm text-text-muted">
              {design.inverter_spec}
            </p>
          ) : (
            <EmptyState
              title="No inverter specified"
              description="Make, model, rating and phase go here."
            />
          )}
        </Card>
      </div>

      <DesignFileSection design={design} readOnly={!canOperate} />

      <GenerationReportSection
        designId={design.id}
        reports={reports}
        readOnly={!canOperate}
      />
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
