import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, Badge } from '@/components/ui/primitives'
import { LeadStageControl } from '@/components/sales/LeadDetail/LeadStageControl'
import { FollowUpSection } from '@/components/sales/LeadDetail/FollowUpSection'
import { SiteVisitSection } from '@/components/sales/LeadDetail/SiteVisitSection'
import { QuotationSection } from '@/components/sales/LeadDetail/QuotationSection'
import { ProposalSection } from '@/components/sales/LeadDetail/ProposalSection'
import { CloseDealButton } from '@/components/sales/LeadDetail/CloseDealButton'
import { MarkLostButton } from '@/components/sales/LeadDetail/MarkLostButton'
import { SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  daysSince,
  LEAD_STATUS_STYLES,
  LEAD_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  LEAD_SOURCE_LABELS,
} from '@/lib/format'
import type {
  Lead,
  FollowUp,
  SiteVisitRequest,
  Quotation,
  Proposal,
  DealClosure,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

type LeadDetail = Lead & {
  assignee: { full_name: string } | null
  assigner: { full_name: string } | null
}

type ClosureRow = DealClosure & {
  closer: { full_name: string } | null
  customer: { id: string; name: string } | null
}

export default async function LeadDetailPage(props: PageProps<'/sales/leads/[leadId]'>) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)
  const { leadId } = await props.params

  const supabase = await createSupabaseServerClient()

  // Both joins target users, so each names its constraint — assigned_to and
  // assigned_by are two different relationships to the same table.
  const { data: leadData } = await supabase
    .from('leads')
    .select(
      '*, assignee:users!leads_assigned_to_fkey(full_name), assigner:users!leads_assigned_by_fkey(full_name)'
    )
    .eq('id', leadId)
    .maybeSingle()

  // RLS decides visibility. An executive requesting a colleague's lead gets no
  // row, which surfaces as the same 404 as a lead that does not exist — a 403
  // would confirm the lead is real, which is itself a leak.
  if (!leadData) notFound()
  const lead = leadData as unknown as LeadDetail

  const [
    { data: followUpData },
    { data: siteVisitData },
    { data: quotationData },
    { data: proposalData },
    { data: closureData },
  ] = await Promise.all([
    supabase
      .from('follow_ups')
      .select('*')
      .eq('lead_id', leadId)
      .order('scheduled_for', { ascending: false }),
    supabase
      .from('site_visit_requests')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),
    supabase
      .from('quotations')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),
    supabase
      .from('proposals')
      .select('*')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false }),
    supabase
      .from('deal_closures')
      .select(
        '*, closer:users!deal_closures_closed_by_fkey(full_name), customer:customers(id, name)'
      )
      .eq('lead_id', leadId)
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const followUps = (followUpData ?? []) as FollowUp[]
  const siteVisits = (siteVisitData ?? []) as SiteVisitRequest[]
  const quotations = (quotationData ?? []) as Quotation[]
  const proposals = (proposalData ?? []) as Proposal[]
  const closure = closureData as unknown as ClosureRow | null

  const won = lead.status === 'won'
  const lost = lead.status === 'lost'
  const closed = won || lost

  // Only a live offer is worth citing in a closure. A rejected or draft proposal
  // is not what the customer agreed to.
  const citableProposals = proposals.filter(
    (p) => p.status === 'accepted' || p.status === 'sent'
  )

  // Best guess at the final figure, in descending order of authority: what the
  // customer accepted, then what was last put to them, then the last live quote.
  // No fall-through to estimated_load_kw — that is a kilowatt figure, and
  // prefilling it as rupees would quietly suggest a nonsense closing amount.
  const suggestedAmount =
    proposals.find((p) => p.status === 'accepted')?.amount ??
    citableProposals[0]?.amount ??
    quotations.find((q) => q.status === 'accepted' || q.status === 'sent')?.amount ??
    null

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <Link href="/sales/leads" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to leads
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold text-brand-slate">{lead.name}</h1>
              <Badge className={LEAD_STATUS_STYLES[lead.status]}>
                {LEAD_STATUS_LABELS[lead.status]}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {lead.phone ?? 'No phone recorded'}
              {lead.email ? ` · ${lead.email}` : ''}
              {lead.source ? ` · via ${LEAD_SOURCE_LABELS[lead.source] ?? lead.source}` : ''}
            </p>
          </div>

          {!readOnly && !closed && (
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link
                href={`/sales/leads/${leadId}/edit`}
                className="rounded-lg border border-border-subtle bg-white px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                Edit
              </Link>
              <MarkLostButton leadId={leadId} />
              <CloseDealButton
                leadId={leadId}
                leadName={lead.name}
                proposals={citableProposals}
                suggestedAmount={suggestedAmount}
              />
            </div>
          )}
        </div>
      </div>

      {/* Closure banner — a won lead's most important fact is what it closed at. */}
      {won && (
        <Card className="border-status-success/25 bg-status-success/5 px-5 py-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-status-success">
                Deal won
              </p>
              <p className="mt-1 text-sm text-status-success">
                {closure
                  ? `Closed at ${formatCurrency(closure.final_amount)} on ${formatDate(closure.closed_at)}${
                      closure.closer ? ` by ${closure.closer.full_name}` : ''
                    }`
                  : 'Closed. The closure record is not visible to you.'}
              </p>
            </div>
            {closure?.customer && (
              <Link
                href={`/sales/customers/${closure.customer.id}`}
                className="rounded-lg border border-status-success/30 bg-white px-4 py-2 text-sm font-medium text-status-success transition-colors hover:bg-status-success/5"
              >
                View customer →
              </Link>
            )}
          </div>
        </Card>
      )}

      {lost && (
        <Card className="border-status-danger/25 bg-status-danger/5 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-status-danger">Lead lost</p>
          <p className="mt-1 text-sm text-status-danger">
            Marked lost {formatDate(lead.updated_at)}. Nothing was deleted — the history below stays
            on the record.
          </p>
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Lead details</h2>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Property type">
              {lead.property_type ? PROPERTY_TYPE_LABELS[lead.property_type] : 'Not recorded'}
            </Field>
            <Field label="Estimated load">
              {lead.estimated_load_kw !== null ? `${lead.estimated_load_kw} kW` : 'Not recorded'}
            </Field>
            <Field label="Owner">{lead.assignee?.full_name ?? 'Unassigned'}</Field>
            <Field label="Added">
              {formatDateTime(lead.created_at)}
              <span className="mt-0.5 block text-xs text-text-muted">
                {daysSince(lead.created_at)} days in the pipeline
                {lead.assigner && lead.assigner.full_name !== lead.assignee?.full_name
                  ? ` · assigned by ${lead.assigner.full_name}`
                  : ''}
              </span>
            </Field>
            {lead.notes && (
              <div className="sm:col-span-2">
                <dt className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                  Notes
                </dt>
                <dd className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                  {lead.notes}
                </dd>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <div className="border-b border-border-subtle px-5 py-4">
            <h2 className="text-sm font-semibold text-brand-slate">Pipeline stage</h2>
            <p className="mt-0.5 text-xs text-text-muted">
              Quotations and proposals move this automatically.
            </p>
          </div>
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Current
              </p>
              <p className="mt-1.5">
                <Badge className={LEAD_STATUS_STYLES[lead.status]}>
                  {LEAD_STATUS_LABELS[lead.status]}
                </Badge>
              </p>
            </div>

            {readOnly ? (
              <p className="text-xs text-text-muted">
                Only the Sales department can move this lead forward.
              </p>
            ) : closed ? (
              <p className="text-xs text-text-muted">
                {LEAD_STATUS_LABELS[lead.status]} is a final state — no further stage changes.
              </p>
            ) : (
              <LeadStageControl leadId={leadId} status={lead.status} />
            )}
          </div>
        </Card>
      </div>

      <FollowUpSection
        leadId={leadId}
        followUps={followUps}
        readOnly={readOnly}
        leadClosed={closed}
      />

      <SiteVisitSection
        leadId={leadId}
        requests={siteVisits}
        readOnly={readOnly}
        leadClosed={closed}
      />

      <QuotationSection
        leadId={leadId}
        quotations={quotations}
        readOnly={readOnly}
        leadClosed={closed}
      />

      <ProposalSection
        leadId={leadId}
        proposals={proposals}
        quotations={quotations}
        readOnly={readOnly}
        leadClosed={closed}
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
