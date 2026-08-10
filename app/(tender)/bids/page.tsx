import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, Badge, EmptyState, StatCard } from '@/components/ui/primitives'
import { BidFilters } from '@/components/tender/BidTracker/BidFilters'
import { getTenderEmployees } from '@/lib/tender/queries'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import {
  formatCurrency,
  formatDate,
  BID_STATUS_STYLES,
  BID_STATUS_LABELS,
} from '@/lib/format'
import type { TenderBid } from '@/lib/types'

export const dynamic = 'force-dynamic'

type BidListRow = TenderBid & {
  tenders: { id: string; title: string; status: string } | null
  assignee: { full_name: string } | null
}

export default async function BidsPage(props: PageProps<'/bids'>) {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const statusFilter = asString(searchParams.status)
  const assigneeFilter = asString(searchParams.assignee)

  const supabase = await createSupabaseServerClient()

  // RLS scopes this to the caller's org through the parent tender, so there is
  // no organization_id to filter on here.
  let query = supabase
    .from('tender_bids')
    .select(
      '*, tenders!inner(id, title, status), assignee:users!tender_bids_assigned_employee_id_fkey(full_name)'
    )
    .order('created_at', { ascending: false })
    .limit(300)

  if (statusFilter) query = query.eq('bid_status', statusFilter)
  if (assigneeFilter === 'unassigned') query = query.is('assigned_employee_id', null)
  else if (assigneeFilter) query = query.eq('assigned_employee_id', assigneeFilter)

  const [{ data: bidData }, employees] = await Promise.all([
    query,
    getTenderEmployees(user.organization_id),
  ])

  const bids = (bidData ?? []) as unknown as BidListRow[]

  const activeCount = bids.filter(
    (b) => b.bid_status === 'submitted' || b.bid_status === 'under_review'
  ).length
  const wonCount = bids.filter((b) => b.bid_status === 'won').length
  const totalValue = bids
    .filter((b) => b.bid_status !== 'lost')
    .reduce((sum, b) => sum + (b.bid_amount ?? 0), 0)

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Bids</h1>
        <p className="mt-1 text-sm text-text-muted">
          Every bid across every tender — what the department is bidding on right now.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total bids" value={bids.length} />
        <StatCard label="In play" value={activeCount} hint="Submitted or under review" />
        <StatCard label="Won" value={wonCount} tone="success" />
        <StatCard
          label="Value in play"
          value={formatCurrency(totalValue)}
          hint="Excludes lost bids"
        />
      </div>

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
