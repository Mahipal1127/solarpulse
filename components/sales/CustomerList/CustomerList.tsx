import Link from 'next/link'
import { EmptyState } from '@/components/ui/primitives'
import { formatCurrency, formatDate } from '@/lib/format'
import type { Customer } from '@/lib/types'

export type CustomerRow = Customer & {
  assignee: { full_name: string } | null
  /**
   * The closure that created this customer. Typed as an array because this is the
   * reverse side of deal_closures.customer_id — Supabase always returns a list
   * there, even though close_deal() writes exactly one row per customer.
   */
  closures: { final_amount: number; closed_at: string }[] | null
}

export function CustomerList({
  customers,
  showAssignee = false,
  emptyTitle = 'No customers yet',
  emptyDescription,
}: {
  customers: CustomerRow[]
  showAssignee?: boolean
  emptyTitle?: string
  emptyDescription?: string
}) {
  if (customers.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="divide-y divide-border-subtle">
      {customers.map((customer) => {
        const closure = customer.closures?.[0]

        return (
          <Link
            key={customer.id}
            href={`/sales/customers/${customer.id}`}
            className="block px-5 py-4 transition hover:bg-surface-bg"
          >
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1 space-y-1.5">
                <h3 className="truncate text-sm font-semibold text-brand-slate">{customer.name}</h3>

                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  {customer.phone && (
                    <span className="font-medium text-text-muted">{customer.phone}</span>
                  )}
                  {customer.email && (
                    <>
                      {customer.phone && <span>·</span>}
                      <span className="truncate">{customer.email}</span>
                    </>
                  )}
                </div>

                {customer.address && (
                  <p className="truncate text-xs text-text-muted">{customer.address}</p>
                )}

                <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                  <span>Since {formatDate(customer.created_at)}</span>
                  {showAssignee && (
                    <>
                      <span>·</span>
                      <span className="font-medium text-text-muted">
                        {customer.assignee?.full_name ?? 'Unassigned'}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {closure && (
                <div className="shrink-0 text-right">
                  <p className="text-sm font-semibold text-status-success">
                    {formatCurrency(closure.final_amount)}
                  </p>
                  <p className="mt-0.5 text-xs text-text-muted">
                    Closed {formatDate(closure.closed_at)}
                  </p>
                </div>
              )}
            </div>
          </Link>
        )
      })}
    </div>
  )
}
