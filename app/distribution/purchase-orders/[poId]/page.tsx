import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireAnyDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { POStatusTracker } from '@/components/distribution/POStatusTracker/POStatusTracker'
import {
  DISTRIBUTION_DEPARTMENT_SLUG,
  PO_APPROVER_DEPARTMENT_SLUGS,
} from '@/lib/services/distribution'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  formatQuantity,
  isPurchaseOrderOverdue,
  MATERIAL_CATEGORY_LABELS,
} from '@/lib/format'
import type { PurchaseOrder, PurchaseOrderItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

type PurchaseOrderDetail = PurchaseOrder & {
  vendor: { id: string; name: string; contact_person: string | null; phone: string | null } | null
  creator: { full_name: string } | null
  approver: { full_name: string } | null
}

export default async function PurchaseOrderDetailPage(
  props: PageProps<'/distribution/purchase-orders/[poId]'>
) {
  // Finance reaches this page too — it is where they approve.
  const user = await requireAnyDepartment([
    DISTRIBUTION_DEPARTMENT_SLUG,
    ...PO_APPROVER_DEPARTMENT_SLUGS,
  ])
  const { poId } = await props.params

  const isDistribution = user.departmentSlug === DISTRIBUTION_DEPARTMENT_SLUG
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)

  /**
   * Who may do what, mirroring the server-side rules rather than deciding them.
   * The route guard, the RLS policies and enforce_po_approval_authority() are what
   * actually hold; these two flags only choose which controls to render.
   */
  const canOperate = isDistribution
  const canApprove =
    user.roleName === 'CEO' || PO_APPROVER_DEPARTMENT_SLUGS.includes(user.departmentSlug ?? '')

  const supabase = await createSupabaseServerClient()

  const { data: poData } = await supabase
    .from('purchase_orders')
    .select(
      '*, vendor:vendors(id, name, contact_person, phone), creator:users!purchase_orders_created_by_fkey(full_name), approver:users!purchase_orders_approved_by_fkey(full_name)'
    )
    .eq('id', poId)
    .maybeSingle()

  // RLS decides. An order outside the caller's organization comes back as no row,
  // the same 404 as one that does not exist.
  if (!poData) notFound()
  const po = poData as unknown as PurchaseOrderDetail

  const { data: itemData } = await supabase
    .from('purchase_order_items')
    .select('*')
    .eq('purchase_order_id', poId)
    .order('created_at', { ascending: true })

  const items = (itemData ?? []) as PurchaseOrderItem[]

  // Summed here only to show alongside the stored figure. The database's
  // recompute trigger owns total_amount; if these two ever disagree, the trigger
  // is right and this page is showing a bug rather than hiding one.
  const lineSum = items.reduce((sum, item) => sum + Number(item.line_total), 0)
  const totalsAgree = Math.abs(lineSum - Number(po.total_amount)) < 0.01

  const overdue = isPurchaseOrderOverdue(po)
  const editable = canOperate && po.status === 'draft'

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/distribution/purchase-orders"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to purchase orders
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-brand-slate">{po.po_number}</h1>
              {overdue && (
                <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/25">Overdue</Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {po.vendor ? (
                <Link
                  href={`/distribution/vendors/${po.vendor.id}`}
                  className="font-medium text-text-muted hover:text-brand-slate"
                >
                  {po.vendor.name}
                </Link>
              ) : (
                'Vendor not recorded'
              )}
              {' · '}
              {formatCurrency(po.total_amount)}
            </p>
          </div>

          {editable && (
            <Link
              href={`/distribution/purchase-orders/${po.id}/edit`}
              className="shrink-0 rounded-lg border border-border-subtle bg-white px-4 py-2.5 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
            >
              Edit order
            </Link>
          )}
        </div>
      </div>

      <Card>
        <CardHeader
          title="Status"
          subtitle="Finance approval precedes ordering — the step cannot be skipped"
        />
        <div className="px-5 py-5">
          <POStatusTracker
            purchaseOrder={po}
            canOperate={canOperate}
            canApprove={canApprove}
            approverLabel={po.approver?.full_name ?? null}
          />
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Line items"
            subtitle={
              po.status === 'draft'
                ? 'Editable while this order is a draft'
                : 'Locked — Finance approved this specific amount'
            }
          />
          {items.length === 0 ? (
            <EmptyState
              title="No line items"
              description="An order cannot be created without at least one, so this is unexpected."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-border-subtle">
                <thead className="bg-surface-bg">
                  <tr>
                    <Th>Item</Th>
                    <Th>Category</Th>
                    <Th className="text-right">Qty</Th>
                    <Th className="text-right">Unit Price</Th>
                    <Th className="text-right">Line Total</Th>
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
                      <td className="px-4 py-3 text-right text-sm text-text-muted">
                        {formatCurrency(item.unit_price)}
                      </td>
                      <td className="px-4 py-3 text-right text-sm font-semibold text-brand-slate">
                        {formatCurrency(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-border-subtle bg-surface-bg">
                  <tr>
                    <td colSpan={4} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-text-muted">
                      Order total
                    </td>
                    <td className="px-4 py-3 text-right text-base font-semibold text-brand-slate">
                      {formatCurrency(po.total_amount)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}

          {/* total_amount is maintained by a database trigger, so this should be
              unreachable. Surfaced rather than swallowed: a silent mismatch between
              the header figure and the lines is exactly the drift the trigger
              exists to prevent, and it should be visible if it ever happens. */}
          {items.length > 0 && !totalsAgree && (
            <p className="border-t border-status-warning/25 bg-status-warning/5 px-5 py-2.5 text-xs text-status-warning">
              ⚠ The stored total ({formatCurrency(po.total_amount)}) does not match the sum of the
              line items ({formatCurrency(lineSum)}). Report this — the recompute trigger should make
              it impossible.
            </p>
          )}
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Order details" />
            <dl className="space-y-4 px-5 py-4">
              <Field label="Raised by">
                {po.creator?.full_name ?? 'Unknown'}
                <span className="mt-0.5 block text-xs text-text-muted">
                  {formatDateTime(po.created_at)}
                </span>
              </Field>
              <Field label="Expected delivery">
                {formatDate(po.expected_delivery_date)}
                {overdue && (
                  <span className="mt-0.5 block text-xs text-status-danger">
                    Past due and not yet received
                  </span>
                )}
              </Field>
              <Field label="Finance approval">
                {po.approved_at ? (
                  <>
                    {po.approver?.full_name ?? 'Approved'}
                    <span className="mt-0.5 block text-xs text-text-muted">
                      {formatDateTime(po.approved_at)}
                    </span>
                  </>
                ) : po.status === 'pending_finance_approval' ? (
                  <span className="text-status-warning">Waiting on Finance</span>
                ) : (
                  <span className="text-text-muted">Not submitted yet</span>
                )}
              </Field>
              {po.notes && (
                <Field label="Notes">
                  <span className="whitespace-pre-wrap">{po.notes}</span>
                </Field>
              )}
            </dl>
          </Card>

          {po.vendor && (
            <Card>
              <CardHeader title="Vendor contact" />
              <dl className="space-y-4 px-5 py-4">
                <Field label="Supplier">
                  <Link
                    href={`/distribution/vendors/${po.vendor.id}`}
                    className="text-brand-slate hover:text-brand-slate"
                  >
                    {po.vendor.name}
                  </Link>
                </Field>
                <Field label="Contact">{po.vendor.contact_person || 'Not recorded'}</Field>
                <Field label="Phone">{po.vendor.phone || 'Not recorded'}</Field>
              </dl>
            </Card>
          )}

          {/* Payment is Finance's, not Distribution's. Said plainly so nobody goes
              looking for a "pay vendor" action that deliberately is not here. */}
          <Card className="border-border-subtle bg-surface-bg px-5 py-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
              Payment
            </p>
            <p className="mt-1.5 text-xs text-text-muted">
              Paying this vendor is Finance&apos;s to handle. Distribution records the order and
              tracks the material; it does not process payment.
            </p>
          </Card>
        </div>
      </div>

      {readOnly && !canApprove && (
        <p className="text-xs text-text-muted">
          You are viewing this order, not operating it.
        </p>
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
