import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  LEAD_STATUS_STYLES,
  LEAD_STATUS_LABELS,
  QUOTATION_STATUS_STYLES,
  QUOTATION_STATUS_LABELS,
} from '@/lib/format'
import type { Customer, Lead, Quotation, DealClosure } from '@/lib/types'

export const dynamic = 'force-dynamic'

type CustomerDetail = Customer & {
  assignee: { full_name: string } | null
  lead: Pick<Lead, 'id' | 'name' | 'status' | 'source' | 'property_type' | 'estimated_load_kw'> | null
}

type ClosureRow = DealClosure & { closer: { full_name: string } | null }

export default async function CustomerDetailPage(
  props: PageProps<'/sales/customers/[customerId]'>
) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const { customerId } = await props.params

  const supabase = await createSupabaseServerClient()

  const { data: customerData } = await supabase
    .from('customers')
    .select(
      '*, assignee:users!customers_assigned_to_fkey(full_name), lead:leads(id, name, status, source, property_type, estimated_load_kw)'
    )
    .eq('id', customerId)
    .maybeSingle()

  // RLS decides this. An executive asking for a colleague's customer gets no row,
  // which is the same 404 as one that does not exist.
  if (!customerData) notFound()
  const customer = customerData as unknown as CustomerDetail

  // The closure and the quotation history hang off the originating lead, so both
  // are empty for a directly-entered customer — which is correct, not a bug.
  const [{ data: closureData }, { data: quotationData }] = await Promise.all([
    supabase
      .from('deal_closures')
      .select('*, closer:users!deal_closures_closed_by_fkey(full_name)')
      .eq('customer_id', customerId)
      .order('closed_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    customer.lead_id
      ? supabase
          .from('quotations')
          .select('*')
          .eq('lead_id', customer.lead_id)
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [] }),
  ])

  const closure = closureData as unknown as ClosureRow | null
  const quotations = (quotationData ?? []) as Quotation[]

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/sales/customers" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to customers
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-brand-slate">{customer.name}</h1>
            <p className="mt-1 text-sm text-text-muted">
              {customer.phone ?? 'No phone recorded'}
              {customer.email ? ` · ${customer.email}` : ''}
            </p>
          </div>

          {customer.lead && (
            <Link
              href={`/sales/leads/${customer.lead.id}`}
              className="shrink-0 rounded-lg border border-border-subtle bg-white px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
            >
              View originating lead →
            </Link>
          )}
        </div>
      </div>

      {closure && (
        <Card className="border-status-success/25 bg-status-success/5 px-5 py-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-status-success">
            Deal closed
          </p>
          <p className="mt-1 text-sm text-status-success">
            {formatCurrency(closure.final_amount)} on {formatDate(closure.closed_at)}
            {closure.closer ? ` by ${closure.closer.full_name}` : ''}
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Customer details" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Account owner">{customer.assignee?.full_name ?? 'Unassigned'}</Field>
            <Field label="Customer since">{formatDateTime(customer.created_at)}</Field>
            <Field label="Installation address">
              {customer.address ? (
                <span className="whitespace-pre-wrap">{customer.address}</span>
              ) : (
                'Not recorded'
              )}
            </Field>
            <Field label="System size">
              {customer.lead?.estimated_load_kw !== null &&
              customer.lead?.estimated_load_kw !== undefined
                ? `${customer.lead.estimated_load_kw} kW (estimated at lead stage)`
                : 'Not recorded'}
            </Field>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Origin" subtitle="Where this customer came from" />
          <div className="space-y-3 px-5 py-4">
            {customer.lead ? (
              <>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Lead
                  </p>
                  <Link
                    href={`/sales/leads/${customer.lead.id}`}
                    className="mt-1 block text-sm font-medium text-brand-slate hover:text-brand-slate"
                  >
                    {customer.lead.name}
                  </Link>
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                    Final stage
                  </p>
                  <p className="mt-1.5">
                    <Badge className={LEAD_STATUS_STYLES[customer.lead.status]}>
                      {LEAD_STATUS_LABELS[customer.lead.status]}
                    </Badge>
                  </p>
                </div>
                {customer.lead.source && (
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Source
                    </p>
                    <p className="mt-1 text-sm capitalize text-brand-slate">
                      {customer.lead.source.replace(/_/g, ' ')}
                    </p>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-text-muted">
                Entered directly rather than converted from a lead, so there is no pipeline history
                to show.
              </p>
            )}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Quotation history"
          subtitle="Everything quoted on the originating lead"
        />
        {quotations.length === 0 ? (
          <EmptyState
            title="No quotations on record"
            description="Only customers converted from a lead carry quotation history."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {quotations.map((quotation) => (
              <li key={quotation.id} className="flex items-start justify-between gap-4 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-brand-slate">
                      {formatCurrency(quotation.amount)}
                    </span>
                    {quotation.system_size_kw !== null && (
                      <span className="text-xs text-text-muted">{quotation.system_size_kw} kW</span>
                    )}
                    <Badge className={QUOTATION_STATUS_STYLES[quotation.status]}>
                      {QUOTATION_STATUS_LABELS[quotation.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    Quoted {formatDate(quotation.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
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
