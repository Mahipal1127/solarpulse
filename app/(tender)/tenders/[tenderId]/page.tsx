import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, Badge } from '@/components/ui/primitives'
import { TenderStatusControl } from '@/components/tender/TenderDetail/TenderStatusControl'
import { BidSection, type BidRow } from '@/components/tender/BidTracker/BidSection'
import { DocumentSection, type DocumentRow } from '@/components/tender/DocumentUpload/DocumentSection'
import { CancelTenderButton } from '@/components/tender/TenderDetail/CancelTenderButton'
import { getTenderEmployees } from '@/lib/tender/queries'
import {
  TENDER_DEPARTMENT_SLUG,
  allowedTenderTransitions,
} from '@/lib/services/tenders'
import {
  formatCurrency,
  formatDateTime,
  isTenderOverdue,
  deadlineCountdown,
  TENDER_STATUS_STYLES,
  TENDER_STATUS_LABELS,
} from '@/lib/format'
import type { Tender } from '@/lib/types'

export const dynamic = 'force-dynamic'

type TenderDetail = Tender & { assignee: { full_name: string } | null }

export default async function TenderDetailPage(props: PageProps<'/tenders/[tenderId]'>) {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TENDER_DEPARTMENT_SLUG)
  const { tenderId } = await props.params

  const supabase = await createSupabaseServerClient()

  const { data: tenderData } = await supabase
    .from('tenders')
    .select('*, assignee:users!tenders_assigned_employee_id_fkey(full_name)')
    .eq('id', tenderId)
    .maybeSingle()

  if (!tenderData) notFound()
  const tender = tenderData as unknown as TenderDetail

  const [{ data: bidData }, { data: documentData }, employees] = await Promise.all([
    supabase
      .from('tender_bids')
      .select('*, assignee:users!tender_bids_assigned_employee_id_fkey(full_name)')
      .eq('tender_id', tenderId)
      .order('created_at', { ascending: false }),
    supabase
      .from('tender_documents')
      .select('*, uploader:users!tender_documents_uploaded_by_fkey(full_name)')
      .eq('tender_id', tenderId)
      .order('created_at', { ascending: false }),
    getTenderEmployees(user.organization_id),
  ])

  const bids = (bidData ?? []) as unknown as BidRow[]
  const documents = (documentData ?? []) as unknown as DocumentRow[]

  const overdue = isTenderOverdue(tender)
  const countdown = deadlineCountdown(tender)
  const transitions = allowedTenderTransitions(tender.status)
  const canCancel = !readOnly && transitions.includes('cancelled')

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <Link href="/tenders" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to tenders
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-brand-slate">{tender.title}</h1>
              <Badge className={TENDER_STATUS_STYLES[tender.status]}>
                {TENDER_STATUS_LABELS[tender.status]}
              </Badge>
              {overdue && (
                <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {tender.issuing_authority ?? 'No issuing authority recorded'}
              {tender.tender_number ? ` · ${tender.tender_number}` : ''}
            </p>
          </div>

          {!readOnly && (
            <div className="flex shrink-0 items-center gap-2">
              <Link
                href={`/tenders/${tenderId}/edit`}
                className="rounded-lg border border-border-subtle bg-white px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                Edit
              </Link>
              {canCancel && <CancelTenderButton tenderId={tenderId} />}
            </div>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Tender details</h2>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Submission deadline">
              <span className={overdue ? 'font-medium text-status-danger' : 'text-brand-slate'}>
                {formatDateTime(tender.submission_deadline)}
              </span>
              {countdown && (
                <span className="mt-0.5 block text-xs text-text-muted">{countdown}</span>
              )}
            </Field>
            <Field label="Estimated value">{formatCurrency(tender.estimated_value)}</Field>
            <Field label="Assigned employee">
              {tender.assignee?.full_name ?? 'Unassigned'}
            </Field>
            <Field label="Logged">{formatDateTime(tender.created_at)}</Field>
            {tender.description && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Description
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                  {tender.description}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Status</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Transitions are validated on the server.
            </p>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Current
              </p>
              <p className="mt-1.5">
                <Badge className={TENDER_STATUS_STYLES[tender.status]}>
                  {TENDER_STATUS_LABELS[tender.status]}
                </Badge>
              </p>
            </div>

            {readOnly ? (
              <p className="text-xs text-text-muted">
                Only the Tender department can move this tender forward.
              </p>
            ) : (
              <TenderStatusControl
                tenderId={tenderId}
                status={tender.status}
                allowedTransitions={transitions}
                readOnly={readOnly}
              />
            )}
          </div>
        </Card>
      </div>

      <BidSection tenderId={tenderId} bids={bids} employees={employees} readOnly={readOnly} />

      <DocumentSection tenderId={tenderId} documents={documents} readOnly={readOnly} />
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
