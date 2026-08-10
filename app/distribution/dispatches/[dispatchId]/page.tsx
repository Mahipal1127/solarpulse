import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { DeliveryStatusTracker } from '@/components/distribution/DeliveryStatusTracker/DeliveryStatusTracker'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import {
  formatDate,
  formatDateTime,
  formatQuantity,
  MATERIAL_CATEGORY_LABELS,
  ALLOCATION_STATUS_STYLES,
  ALLOCATION_STATUS_LABELS,
  RETURN_STATUS_STYLES,
  RETURN_STATUS_LABELS,
  MATERIAL_CONDITION_LABELS,
} from '@/lib/format'
import type {
  MaterialDispatch,
  MaterialDispatchItem,
  MaterialAllocation,
  MaterialReturn,
} from '@/lib/types'

export const dynamic = 'force-dynamic'

type DispatchDetail = MaterialDispatch & {
  lead: { id: string; name: string; phone: string | null } | null
  dispatcher: { full_name: string } | null
}

export default async function DispatchDetailPage(
  props: PageProps<'/distribution/dispatches/[dispatchId]'>
) {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)
  const { dispatchId } = await props.params

  const supabase = await createSupabaseServerClient()

  const { data: dispatchData } = await supabase
    .from('material_dispatches')
    .select(
      '*, lead:leads(id, name, phone), dispatcher:users!material_dispatches_dispatched_by_fkey(full_name)'
    )
    .eq('id', dispatchId)
    .maybeSingle()

  // RLS decides. A dispatch outside the caller's organization comes back as no
  // row, the same 404 as one that does not exist.
  if (!dispatchData) notFound()
  const dispatch = dispatchData as unknown as DispatchDetail

  const [{ data: itemData }, { data: allocationData }, { data: returnData }] = await Promise.all([
    supabase
      .from('material_dispatch_items')
      .select('*')
      .eq('dispatch_id', dispatchId)
      .order('created_at', { ascending: true }),
    // The allocations this dispatch fulfilled, found through linked_dispatch_id —
    // set by create_dispatch_from_allocations() in the same transaction that
    // created the dispatch, so this is the audit of what the plan committed to.
    supabase
      .from('material_allocations')
      .select('*')
      .eq('linked_dispatch_id', dispatchId)
      .order('created_at', { ascending: true }),
    supabase
      .from('material_returns')
      .select('*')
      .eq('dispatch_id', dispatchId)
      .order('created_at', { ascending: false }),
  ])

  const items = (itemData ?? []) as MaterialDispatchItem[]
  const allocations = (allocationData ?? []) as MaterialAllocation[]
  const returns = (returnData ?? []) as MaterialReturn[]

  const canOperate = !readOnly

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/distribution/dispatches"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to dispatches
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-brand-slate">{dispatch.dispatch_number}</h1>
            <p className="mt-1 text-sm text-text-muted">
              {dispatch.lead ? dispatch.lead.name : 'Internal transfer — no project'}
              {' · '}
              {items.length} item{items.length === 1 ? '' : 's'}
            </p>
          </div>

          {!readOnly && dispatch.status === 'delivered' && (
            <Link
              href={`/distribution/returns/new?dispatch=${dispatch.id}`}
              className="shrink-0 rounded-lg border border-border-subtle bg-white px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
            >
              Log a return
            </Link>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Delivery status"
          subtitle="Updated by hand as the vehicle moves — no live tracking"
        />
        <div className="px-5 py-5">
          <DeliveryStatusTracker dispatch={dispatch} canOperate={canOperate} />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Material on this dispatch" />
          {items.length === 0 ? (
            <EmptyState
              title="No items"
              description="A dispatch cannot be created without at least one, so this is unexpected."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border-subtle">
                <thead className="bg-surface-bg">
                  <tr>
                    <Th>Item</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Quantity</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-4 py-3 text-sm font-medium text-brand-slate">
                        {item.item_name}
                      </td>
                      <td className="px-4 py-3 text-sm text-text-muted">
                        {item.category
                          ? MATERIAL_CATEGORY_LABELS[item.category] ?? item.category
                          : '—'}
                      </td>
                      <td className="px-4 py-3 text-right text-sm text-text-muted">
                        {formatQuantity(item.quantity, item.unit)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Dispatch details" />
            <dl className="space-y-4 px-5 py-4">
              <Field label="Prepared by">
                {dispatch.dispatcher?.full_name ?? 'Unknown'}
                <span className="mt-0.5 block text-xs text-text-muted">
                  {formatDateTime(dispatch.created_at)}
                </span>
              </Field>
              <Field label="Vehicle">{dispatch.vehicle_details || 'Not recorded'}</Field>
              <Field label="Driver contact">{dispatch.driver_contact || 'Not recorded'}</Field>
              {dispatch.lead && (
                <Field label="Site contact">
                  {dispatch.lead.phone ?? 'Not recorded'}
                  <span className="mt-0.5 block text-xs text-text-muted">
                    From the project record
                  </span>
                </Field>
              )}
              {dispatch.delivery_notes && (
                <Field label="Delivery notes">
                  <span className="whitespace-pre-wrap">{dispatch.delivery_notes}</span>
                </Field>
              )}
            </dl>
          </Card>

          {/* What the plan committed to, versus what actually went. Worth showing
              side by side: these rows were flipped to 'dispatched' in the same
              transaction that created this dispatch, so a mismatch would mean the
              atomic write did not hold. */}
          <Card>
            <CardHeader
              title="Allocations fulfilled"
              subtitle={
                allocations.length > 0
                  ? 'Marked dispatched with this record'
                  : 'This dispatch was raised ad hoc'
              }
            />
            {allocations.length === 0 ? (
              <div className="px-5 py-4">
                <p className="text-xs text-text-muted">
                  No planned allocations behind this one — the material was added directly.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle">
                {allocations.map((allocation) => (
                  <li key={allocation.id} className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-brand-slate">
                        {allocation.item_name}
                      </span>
                      <Badge className={ALLOCATION_STATUS_STYLES[allocation.status]}>
                        {ALLOCATION_STATUS_LABELS[allocation.status]}
                      </Badge>
                    </div>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {formatQuantity(allocation.quantity, allocation.unit)} · planned{' '}
                      {formatDate(allocation.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {allocations.length > 0 && (
              <div className="border-t border-border-subtle px-5 py-3">
                <Link
                  href="/distribution/allocations"
                  className="text-xs font-medium text-brand-slate hover:text-brand-slate"
                >
                  Open the allocation board →
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>

      {returns.length > 0 && (
        <Card>
          <CardHeader
            title="Returns from this dispatch"
            subtitle="Material that came back from site"
          />
          <ul className="divide-y divide-border-subtle">
            {returns.map((materialReturn) => (
              <li
                key={materialReturn.id}
                className="flex flex-wrap items-start justify-between gap-3 px-5 py-3"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-brand-slate">
                      {materialReturn.item_name}
                    </span>
                    <span className="text-sm text-text-muted">
                      {formatQuantity(materialReturn.quantity, materialReturn.unit)}
                    </span>
                    <Badge className={RETURN_STATUS_STYLES[materialReturn.status]}>
                      {RETURN_STATUS_LABELS[materialReturn.status]}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-text-muted">
                    {MATERIAL_CONDITION_LABELS[materialReturn.condition]} condition · returned{' '}
                    {formatDate(materialReturn.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          <div className="border-t border-border-subtle px-5 py-3">
            <Link
              href="/distribution/returns"
              className="text-xs font-medium text-brand-slate hover:text-brand-slate"
            >
              Open returns →
            </Link>
          </div>
        </Card>
      )}
    </div>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-text-muted ${className}`}
    >
      {children}
    </th>
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
