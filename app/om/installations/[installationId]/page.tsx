import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, Badge } from '@/components/ui/primitives'
import { StatusControl } from '@/components/om/InstallationDetail/StatusControl'
import { TeamSection } from '@/components/om/InstallationDetail/TeamSection'
import { ProgressSection } from '@/components/om/InstallationDetail/ProgressSection'
import { PhotoSection } from '@/components/om/InstallationDetail/PhotoSection'
import { ChecklistSection } from '@/components/om/InstallationDetail/ChecklistSection'
import { InspectionSection } from '@/components/om/InstallationDetail/InspectionSection'
import { CompletionSection } from '@/components/om/InstallationDetail/CompletionSection'
import { getInstallationDetail, getOMEmployees } from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import {
  formatDate,
  formatDateTime,
  INSTALLATION_STATUS_STYLES,
  INSTALLATION_STATUS_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function InstallationDetailPage(
  props: PageProps<'/om/installations/[installationId]'>
) {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, OM_DEPARTMENT_SLUG)
  const { installationId } = await props.params

  const [inst, roster] = await Promise.all([
    getInstallationDetail(installationId),
    getOMEmployees(user.organization_id),
  ])

  // RLS decides visibility. A technician requesting a site they are not on gets no
  // row — the same 404 as one that does not exist, so the response never confirms a
  // site they cannot see is real.
  if (!inst) notFound()

  const terminal = inst.status === 'completed' || inst.status === 'cancelled'

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <Link
          href="/om/installations"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to installations
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-brand-slate">
                {inst.customer?.name ?? 'Unknown customer'}
              </h1>
              <Badge className={INSTALLATION_STATUS_STYLES[inst.status]}>
                {INSTALLATION_STATUS_LABELS[inst.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {inst.address ?? 'No site address recorded'}
              {inst.system_size_kw !== null ? ` · ${inst.system_size_kw} kW` : ''}
            </p>
          </div>

          {!readOnly && (
            <Link
              href={`/om/installations/${installationId}/edit`}
              className="rounded-lg border border-border-subtle bg-white px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
            >
              Edit
            </Link>
          )}
        </div>
      </div>

      {/* Summary + status */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Installation details</h2>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Team lead">{inst.team_lead?.full_name ?? 'Unassigned'}</Field>
            <Field label="System size">
              {inst.system_size_kw !== null ? `${inst.system_size_kw} kW` : 'Not recorded'}
            </Field>
            <Field label="Scheduled start">
              {inst.scheduled_start_date ? formatDate(inst.scheduled_start_date) : 'Not set'}
            </Field>
            <Field label="Actual start">
              {inst.actual_start_date ? formatDate(inst.actual_start_date) : 'Not started'}
            </Field>
            <Field label="Completed">
              {inst.completed_date ? formatDate(inst.completed_date) : '—'}
            </Field>
            <Field label="Created">{formatDateTime(inst.created_at)}</Field>
            {inst.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Notes
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                  {inst.notes}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Status</h2>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Current
              </p>
              <p className="mt-1.5">
                <Badge className={INSTALLATION_STATUS_STYLES[inst.status]}>
                  {INSTALLATION_STATUS_LABELS[inst.status]}
                </Badge>
              </p>
            </div>
            {readOnly ? (
              <p className="text-xs text-text-muted">
                Only the Operations &amp; Maintenance department can move this installation.
              </p>
            ) : (
              <StatusControl installationId={installationId} status={inst.status} />
            )}
          </div>
        </Card>
      </div>

      <TeamSection
        installationId={installationId}
        members={inst.team}
        teamLeadName={inst.team_lead?.full_name ?? null}
        roster={roster}
        readOnly={readOnly}
      />

      <ProgressSection
        installationId={installationId}
        updates={inst.progress}
        readOnly={readOnly || terminal}
      />

      <PhotoSection installationId={installationId} photos={inst.photos} readOnly={readOnly} />

      <ChecklistSection
        installationId={installationId}
        items={inst.checklist}
        readOnly={readOnly}
      />

      <InspectionSection
        installationId={installationId}
        inspections={inst.inspections}
        readOnly={readOnly}
      />

      <CompletionSection
        installationId={installationId}
        reports={inst.completion}
        status={inst.status}
        readOnly={readOnly}
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
