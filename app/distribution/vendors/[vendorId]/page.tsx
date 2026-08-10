import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { VendorForm } from '@/components/distribution/VendorForm/VendorForm'
import { VendorStatusToggle } from '@/components/distribution/VendorForm/VendorStatusToggle'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import {
  formatCurrency,
  formatDate,
  formatDateTime,
  isPurchaseOrderOverdue,
  MATERIAL_CATEGORY_LABELS,
  PO_STATUS_STYLES,
  PO_STATUS_LABELS,
} from '@/lib/format'
import type { Vendor, PurchaseOrder } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function VendorDetailPage(props: PageProps<'/distribution/vendors/[vendorId]'>) {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)
  const { vendorId } = await props.params

  const supabase = await createSupabaseServerClient()

  const { data: vendorData } = await supabase
    .from('vendors')
    .select('*, creator:users!vendors_created_by_fkey(full_name)')
    .eq('id', vendorId)
    .maybeSingle()

  // RLS decides. A vendor outside the caller's organization comes back as no row,
  // which is the same 404 as one that does not exist.
  if (!vendorData) notFound()
  const vendor = vendorData as unknown as Vendor & { creator: { full_name: string } | null }

  const { data: poData } = await supabase
    .from('purchase_orders')
    .select('*')
    .eq('vendor_id', vendorId)
    .order('created_at', { ascending: false })
    .limit(50)

  const purchaseOrders = (poData ?? []) as PurchaseOrder[]

  // Only settled orders count towards spend. A draft or a PO awaiting Finance is
  // not money committed to this vendor yet, and counting it would overstate them.
  const committed = purchaseOrders
    .filter((po) => po.status !== 'draft' && po.status !== 'pending_finance_approval' && po.status !== 'cancelled')
    .reduce((sum, po) => sum + Number(po.total_amount), 0)

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/distribution/vendors" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to vendors
        </Link>

        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-2xl font-semibold text-brand-slate">{vendor.name}</h1>
              <Badge
                className={
                  vendor.is_active
                    ? 'bg-status-success/10 text-status-success ring-status-success/25'
                    : 'bg-surface-bg text-text-muted ring-border-subtle'
                }
              >
                {vendor.is_active ? 'Active' : 'Inactive'}
              </Badge>
            </div>
            <p className="mt-1 text-sm text-text-muted">
              {vendor.category
                ? MATERIAL_CATEGORY_LABELS[vendor.category] ?? vendor.category
                : 'Category not recorded'}
              {vendor.phone ? ` · ${vendor.phone}` : ''}
            </p>
          </div>

          {!readOnly && (
            <div className="shrink-0">
              <VendorStatusToggle vendor={vendor} />
            </div>
          )}
        </div>
      </div>

      {!vendor.is_active && (
        <Card className="border-border-subtle bg-surface-bg px-5 py-4">
          <p className="text-sm text-text-muted">
            This vendor is deactivated, so they will not appear when raising a new purchase order.
            Their {purchaseOrders.length} existing order{purchaseOrders.length === 1 ? '' : 's'}{' '}
            {purchaseOrders.length === 1 ? 'is' : 'are'} untouched — deactivating is never a delete.
          </p>
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Vendor details" />
          <dl className="grid grid-cols-1 gap-x-6 gap-y-4 px-5 py-4 sm:grid-cols-2">
            <Field label="Contact person">{vendor.contact_person || 'Not recorded'}</Field>
            <Field label="Phone">{vendor.phone || 'Not recorded'}</Field>
            <Field label="Email">{vendor.email || 'Not recorded'}</Field>
            <Field label="GSTIN">{vendor.gstin || 'Not recorded'}</Field>
            <Field label="Address">
              {vendor.address ? (
                <span className="whitespace-pre-wrap">{vendor.address}</span>
              ) : (
                'Not recorded'
              )}
            </Field>
            <Field label="Added">
              {formatDateTime(vendor.created_at)}
              {vendor.creator ? ` by ${vendor.creator.full_name}` : ''}
            </Field>
            {vendor.notes && (
              <div className="sm:col-span-2">
                <Field label="Notes">
                  <span className="whitespace-pre-wrap">{vendor.notes}</span>
                </Field>
              </div>
            )}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Order history" subtitle="With this vendor" />
          <div className="space-y-4 px-5 py-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Purchase orders
              </p>
              <p className="mt-1 text-2xl font-semibold text-brand-slate">{purchaseOrders.length}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                Committed value
              </p>
              <p className="mt-1 text-xl font-semibold text-brand-slate">
                {formatCurrency(committed)}
              </p>
              <p className="mt-1 text-xs text-text-muted">
                Approved and later. Drafts and orders awaiting Finance are excluded.
              </p>
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Purchase orders"
          subtitle="Most recent first"
          action={
            !readOnly && vendor.is_active ? (
              <Link
                href="/distribution/purchase-orders/new"
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
              >
                New order
              </Link>
            ) : undefined
          }
        />
        {purchaseOrders.length === 0 ? (
          <EmptyState
            title="No purchase orders with this vendor"
            description="Orders raised against them will appear here."
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {purchaseOrders.map((po) => {
              const overdue = isPurchaseOrderOverdue(po)
              return (
                <li key={po.id} className="flex items-start justify-between gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/distribution/purchase-orders/${po.id}`}
                        className="text-sm font-semibold text-brand-slate hover:text-brand-slate"
                      >
                        {po.po_number}
                      </Link>
                      <Badge className={PO_STATUS_STYLES[po.status]}>
                        {PO_STATUS_LABELS[po.status]}
                      </Badge>
                      {overdue && (
                        <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/25">Overdue</Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      Raised {formatDate(po.created_at)}
                      {po.expected_delivery_date
                        ? ` · expected ${formatDate(po.expected_delivery_date)}`
                        : ''}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-brand-slate">
                    {formatCurrency(po.total_amount)}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      {!readOnly && (
        <Card className="max-w-3xl">
          <CardHeader title="Edit vendor" subtitle="Contact and commercial details" />
          <div className="px-5 py-5">
            <VendorForm mode="edit" vendor={vendor} />
          </div>
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
