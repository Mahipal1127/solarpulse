import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader, Badge } from '@/components/ui/primitives'
import { AgingBadge } from '@/components/discom/AgingBadge'
import { CaseStatusControl } from '@/components/discom/CaseStatusControl'
import { StatusTimeline } from '@/components/discom/StatusTimeline'
import { SubsidyDetailsForm } from '@/components/discom/SubsidyDetailsForm'
import { getSubsidyDetail, getDiscomEmployees } from '@/lib/discom/dashboard'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { SUBSIDY_STATUSES, formatSubsidyScheme } from '@/lib/discom/constants'
import {
  formatDate,
  formatCurrency,
  SUBSIDY_STATUS_STYLES,
  SUBSIDY_STATUS_LABELS,
  GOVERNMENT_DOCUMENT_TYPE_LABELS,
  DISCOM_STALENESS_THRESHOLD_DAYS,
} from '@/lib/format'
import type { GovernmentDocumentType } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function SubsidyDetailPage(props: PageProps<'/discom/subsidy/[caseId]'>) {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)
  const { caseId } = await props.params

  const [sc, liaisons] = await Promise.all([
    getSubsidyDetail(caseId),
    getDiscomEmployees(user.organization_id),
  ])

  if (!sc) notFound()

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/discom/subsidy" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to subsidy
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-brand-slate">
                {sc.customer?.name ?? 'Unknown customer'}
              </h1>
              <Badge className={SUBSIDY_STATUS_STYLES[sc.status]}>
                {SUBSIDY_STATUS_LABELS[sc.status]}
              </Badge>
              <AgingBadge days={sc.daysInStatus} isStale={sc.isStale} />
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {formatSubsidyScheme(sc.scheme)}
              {sc.installation?.address ? ` · ${sc.installation.address}` : ''}
              {sc.application_reference ? ` · Ref ${sc.application_reference}` : ''}
            </p>
          </div>
        </div>

        {sc.isStale && (
          <div className="notice-warning mt-3 rounded-lg px-4 py-2.5">
            <p className="text-xs font-medium">
              This case has been in {SUBSIDY_STATUS_LABELS[sc.status]} for {sc.daysInStatus} days —
              past the {DISCOM_STALENESS_THRESHOLD_DAYS}-day mark. Chase it or record where it stands.
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
                  endpoint={`/api/subsidy/${sc.id}`}
                  current={sc.status}
                  statuses={SUBSIDY_STATUSES}
                  labels={SUBSIDY_STATUS_LABELS}
                />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Status history" subtitle="Newest first — where the case has been." />
            <div className="p-5">
              <StatusTimeline
                openedAt={sc.created_at}
                entries={sc.history.map((h) => ({
                  id: h.id,
                  label: SUBSIDY_STATUS_LABELS[h.status],
                  note: h.note,
                  created_at: h.created_at,
                  author: h.author,
                }))}
              />
            </div>
          </Card>

          {!readOnly && (
            <Card>
              <CardHeader title="Details" subtitle="Reference and disbursement amounts." />
              <div className="p-5">
                <SubsidyDetailsForm subsidyCase={sc} liaisons={liaisons} />
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Summary" />
            <dl className="divide-y divide-border-subtle text-sm">
              <Row label="Liaison" value={sc.assignee?.full_name ?? 'Unassigned'} />
              <Row
                label="Eligible"
                value={
                  sc.eligible_subsidy_amount !== null
                    ? formatCurrency(Number(sc.eligible_subsidy_amount))
                    : '—'
                }
              />
              <Row
                label="Disbursed"
                value={
                  sc.disbursed_amount !== null ? formatCurrency(Number(sc.disbursed_amount)) : '—'
                }
              />
              <Row label="Applied" value={sc.applied_date ? formatDate(sc.applied_date) : '—'} />
              <Row
                label="Disbursed on"
                value={sc.disbursed_date ? formatDate(sc.disbursed_date) : '—'}
              />
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Documents"
              subtitle="Government paperwork linked to this case."
              action={
                <Link
                  href={`/discom/documents?subsidy_case_id=${sc.id}`}
                  className="text-xs font-medium text-brand-slate hover:text-brand-gold"
                >
                  Manage →
                </Link>
              }
            />
            {sc.documents.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-text-muted">
                No documents linked yet.
              </p>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {sc.documents.map((doc) => (
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

          {sc.notes && (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap px-5 py-4 text-sm text-text-muted">{sc.notes}</p>
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
