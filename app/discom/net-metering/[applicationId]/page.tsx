import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader, Badge } from '@/components/ui/primitives'
import { AgingBadge } from '@/components/discom/AgingBadge'
import { CaseStatusControl } from '@/components/discom/CaseStatusControl'
import { StatusTimeline } from '@/components/discom/StatusTimeline'
import { NetMeteringDetailsForm } from '@/components/discom/NetMeteringDetailsForm'
import { getNetMeteringDetail, getDiscomEmployees } from '@/lib/discom/dashboard'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { NET_METERING_STATUSES } from '@/lib/discom/constants'
import {
  formatDate,
  NET_METERING_STATUS_STYLES,
  NET_METERING_STATUS_LABELS,
  GOVERNMENT_DOCUMENT_TYPE_LABELS,
  DISCOM_STALENESS_THRESHOLD_DAYS,
} from '@/lib/format'
import type { GovernmentDocumentType } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function NetMeteringDetailPage(
  props: PageProps<'/discom/net-metering/[applicationId]'>
) {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)
  const { applicationId } = await props.params

  const [app, liaisons] = await Promise.all([
    getNetMeteringDetail(applicationId),
    getDiscomEmployees(user.organization_id),
  ])

  // RLS decides visibility: a liaison requesting a case not theirs gets no row — the
  // same 404 as one that does not exist, so the response never confirms it is real.
  if (!app) notFound()

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/discom/net-metering" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to net metering
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-brand-slate">
                {app.customer?.name ?? 'Unknown customer'}
              </h1>
              <Badge className={NET_METERING_STATUS_STYLES[app.status]}>
                {NET_METERING_STATUS_LABELS[app.status]}
              </Badge>
              <AgingBadge days={app.daysInStatus} isStale={app.isStale} />
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {app.installation?.address ?? 'No site address recorded'}
              {app.discom_name ? ` · ${app.discom_name}` : ''}
              {app.consumer_number ? ` · Consumer ${app.consumer_number}` : ''}
            </p>
          </div>
        </div>

        {app.isStale && (
          <div className="notice-warning mt-3 rounded-lg px-4 py-2.5">
            <p className="text-xs font-medium">
              This case has been in {NET_METERING_STATUS_LABELS[app.status]} for {app.daysInStatus}{' '}
              days — past the {DISCOM_STALENESS_THRESHOLD_DAYS}-day mark. Chase it or record where it
              stands.
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!readOnly && (
            <Card>
              <CardHeader
                title="Record a status change"
                subtitle="Every change is logged and resets the time-in-status clock."
              />
              <div className="p-5">
                <CaseStatusControl
                  endpoint={`/api/net-metering/${app.id}`}
                  current={app.status}
                  statuses={NET_METERING_STATUSES}
                  labels={NET_METERING_STATUS_LABELS}
                />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Status history" subtitle="Newest first — where the case has been." />
            <div className="p-5">
              <StatusTimeline
                openedAt={app.created_at}
                entries={app.history.map((h) => ({
                  id: h.id,
                  label: NET_METERING_STATUS_LABELS[h.status],
                  note: h.note,
                  created_at: h.created_at,
                  author: h.author,
                }))}
              />
            </div>
          </Card>

          {!readOnly && (
            <Card>
              <CardHeader title="Details" subtitle="Consumer and application information." />
              <div className="p-5">
                <NetMeteringDetailsForm application={app} liaisons={liaisons} />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <dl className="divide-y divide-border-subtle text-sm">
              <Row label="Liaison" value={app.assignee?.full_name ?? 'Unassigned'} />
              <Row label="Application no." value={app.application_number ?? '—'} />
              <Row label="Submitted" value={app.submitted_date ? formatDate(app.submitted_date) : '—'} />
              <Row label="Approved" value={app.approved_date ? formatDate(app.approved_date) : '—'} />
              {app.rejection_reason && <Row label="Rejection" value={app.rejection_reason} />}
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              subtitle="Government paperwork linked to this application."
              action={
                <Link
                  href={`/discom/documents?net_metering_application_id=${app.id}`}
                  className="text-xs font-medium text-brand-slate hover:text-brand-gold"
                >
                  Manage →
                </Link>
              }
            />
            {app.documents.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-text-muted">
                No documents linked yet.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {app.documents.map((doc) => (
                  <li key={doc.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <span className="min-w-0 truncate text-sm text-brand-slate">{doc.file_name}</span>
                    <span className="shrink-0 text-xs text-text-muted">
                      {GOVERNMENT_DOCUMENT_TYPE_LABELS[doc.document_type as GovernmentDocumentType] ??
                        doc.document_type}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {app.notes && (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-text-muted">{app.notes}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-3">
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="text-right text-brand-slate">{value}</dd>
    </div>
  )
}
