import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { Card, Badge, EmptyState, StatCard } from '@/components/ui/primitives'
import { BidFilters } from '@/components/tender/BidTracker/BidFilters'
import { getTenderEmployees } from '@/lib/tender/queries'
import { getBidSummary } from '@/lib/tender/dashboard'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import {
  formatCurrency,
  formatDate,
  BID_STATUS_STYLES,
  BID_STATUS_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Every bid across every tender.
 *
 * TWO BUGS THIS PAGE USED TO HAVE
 * "Value in play" was `sum + (b.bid_amount ?? 0)` over a numeric(14,2) column, and
 * supabase-js returns numeric as a *string* to avoid float precision loss. So the
 * first iteration produced `0 + "50000"` — the string "050000" — and every later one
 * concatenated onto it. Two ₹50,000 bids reported ₹5,00,00,50,000. Every other module
 * wraps these columns in Number() for exactly this reason; this one did not.
 *
 * The four cards were also computed from the filtered query, so selecting "Won" made
 * "In play" read 0. Both are now taken from getBidSummary(), which is the same
 * aggregation the overview uses, and the filters are applied in JS over the rows it
 * returned.
 */
export default async function BidsPage(props: PageProps<'/bids'>) {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const statusFilter = asString(searchParams.status)
  const assigneeFilter = asString(searchParams.assignee)

  const [summary, employees] = await Promise.all([
    getBidSummary(),
    getTenderEmployees(user.organization_id),
  ])

  let bids = summary.all

  if (statusFilter) bids = bids.filter((b) => b.bid_status === statusFilter)
  if (assigneeFilter === 'unassigned') {
    bids = bids.filter((b) => b.assigned_employee_id === null)
  } else if (assigneeFilter) {
    bids = bids.filter((b) => b.assigned_employee_id === assigneeFilter)
  }

  const filtered = bids.length !== summary.total

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Bids</h1>
        <p className="mt-1 text-sm text-text-muted">
          Every bid across every tender — what the department is bidding on right now.
          {filtered && ` Showing ${bids.length} of ${summary.total}.`}
        </p>
      </div>

      {/*
        Department-wide, unaffected by the filters below — the same correction made on
        /tenders. Selecting "Won" used to make "In play" read 0, which looks like the
        department has nothing outstanding.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total bids" value={summary.total} />
        <StatCard label="In play" value={summary.inPlay} hint="Submitted or under review" />
        <StatCard
          label="Won"
          value={summary.won}
          tone="success"
          hint={summary.wonValue > 0 ? formatCurrency(summary.wonValue) : undefined}
        />
        <StatCard
          label="Value in play"
          value={formatCurrency(summary.valueInPlay)}
          hint="Excludes lost bids"
        />
      </div>

      {summary.capped && (
        <p className="text-xs text-text-muted">
          Showing the most recent records only — the figures above cover what could be read
          in one page, not the full history.
        </p>
      )}

      <Card className="p-4">
        <BidFilters employees={employees} />
      </Card>

      <Card>
        {bids.length === 0 ? (
          <EmptyState
            title="No bids match these filters"
            description="Bids are created from a tender's detail page."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-5 py-3 font-medium">Tender</th>
                  <th className="px-3 py-3 text-right font-medium">Amount</th>
                  <th className="px-3 py-3 font-medium">Status</th>
                  <th className="px-3 py-3 font-medium">Assigned to</th>
                  <th className="px-5 py-3 font-medium">Submitted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {bids.map((bid) => (
                  <tr key={bid.id} className="transition hover:bg-surface-bg">
                    <td className="px-5 py-3">
                      {bid.tenders ? (
                        <Link
                          href={`/tenders/${bid.tenders.id}`}
                          className="font-medium text-brand-slate hover:text-brand-slate hover:underline"
                        >
                          {bid.tenders.title}
                        </Link>
                      ) : (
                        <span className="text-text-muted">—</span>
                      )}
                      {bid.notes && (
                        <p className="mt-0.5 line-clamp-1 text-xs text-text-muted">{bid.notes}</p>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right font-semibold text-brand-slate">
                      {formatCurrency(bid.bid_amount)}
                    </td>
                    <td className="px-3 py-3">
                      <Badge className={BID_STATUS_STYLES[bid.bid_status]}>
                        {BID_STATUS_LABELS[bid.bid_status]}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-text-muted">
                      {bid.assignee?.full_name ?? (
                        <span className="text-text-muted/60">Unassigned</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-text-muted">
                      {bid.submitted_at ? formatDate(bid.submitted_at) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
