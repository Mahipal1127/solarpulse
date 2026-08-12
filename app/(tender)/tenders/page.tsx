import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, StatCard } from '@/components/ui/primitives'
import { TenderList } from '@/components/tender/TenderList/TenderList'
import { TenderFilters } from '@/components/tender/TenderList/TenderFilters'
import { getTenderEmployees } from '@/lib/tender/queries'
import { getTenderSummary } from '@/lib/tender/dashboard'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { isTenderOverdue } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The department's tender list.
 *
 * WHY THE FILTERING MOVED OUT OF SQL
 * The stat cards used to be computed from the same array the list renders — which
 * the filters had already narrowed. Filtering to "Submitted" therefore reported
 * "Open 0, Preparing Bid 0", because there were no open tenders *in the filtered
 * set*. A card that changes meaning depending on a dropdown is worse than no card:
 * it reads as a department-wide figure and isn't one.
 *
 * So the cards now come from getTenderSummary(), the same aggregation the overview
 * and the CEO's drill-down use, and the filters are applied in JS over the rows it
 * already returned. That is one read instead of two, and the four figures state the
 * department's position no matter what is selected.
 *
 * The trade-off, stated because it is real: the summary caps its read, so with more
 * tenders than the cap a narrow filter sees only the matches inside that first page
 * rather than the first N matches. The cards surface `capped` when that happens
 * instead of quietly presenting a truncated count as a total.
 */
export default async function TendersPage(props: PageProps<'/tenders'>) {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TENDER_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const statusFilter = asString(searchParams.status)
  const assigneeFilter = asString(searchParams.assignee)
  const overdueOnly = asString(searchParams.overdue) === '1'

  const [summary, employees] = await Promise.all([
    getTenderSummary(user.organization_id),
    getTenderEmployees(user.organization_id),
  ])

  // Already deadline-ascending from the summary's query: the tender closing soonest
  // is the one that matters, and that ordering survives every filter below.
  let tenders = summary.all

  if (statusFilter) tenders = tenders.filter((t) => t.status === statusFilter)
  if (assigneeFilter === 'unassigned') {
    tenders = tenders.filter((t) => t.assigned_employee_id === null)
  } else if (assigneeFilter) {
    tenders = tenders.filter((t) => t.assigned_employee_id === assigneeFilter)
  }
  // Overdue is derived from the clock, so it could never have been a SQL filter —
  // there is no stored flag to query against.
  if (overdueOnly) tenders = tenders.filter(isTenderOverdue)

  // How many of the *shown* rows are late, which is a fact about this list. The
  // cards below deliberately report the department instead.
  const shownOverdue = tenders.filter(isTenderOverdue).length
  const filtered = tenders.length !== summary.total

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Tenders</h1>
          {/*
            This line describes the list; the cards below describe the department.
            When a filter is on it says so explicitly — "12 of 40" cannot be mistaken
            for a total the way a bare "12 total" could.
          */}
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            <span>
              {filtered ? `${tenders.length} of ${summary.total} shown` : `${tenders.length} total`}
            </span>
            {shownOverdue > 0 && (
              <>
                <span>·</span>
                <span className="font-medium text-status-danger">{shownOverdue} overdue</span>
              </>
            )}
          </div>
        </div>
        {!readOnly && (
          <Link
            href="/tenders/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + Add tender
          </Link>
        )}
      </div>

      {/*
        Whole-department figures, unaffected by the filters below. The hint says so
        when a filter is active, because four numbers sitting directly above a
        filtered list will otherwise be read as describing that list.
      */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={summary.open} hint={filtered ? 'Across all tenders' : undefined} />
        <StatCard
          label="Preparing Bid"
          value={summary.preparingBid}
          hint={filtered ? 'Across all tenders' : undefined}
        />
        <StatCard
          label="Submitted"
          value={summary.submitted}
          tone="success"
          hint={filtered ? 'Across all tenders' : undefined}
        />
        <StatCard
          label="Overdue"
          value={summary.overdue.length}
          tone={summary.overdue.length > 0 ? 'danger' : 'default'}
          hint="Past deadline, not yet submitted"
        />
      </div>

      {summary.capped && (
        <p className="text-xs text-text-muted">
          Showing the most recent records only — the figures above cover what could be read
          in one page, not the full history.
        </p>
      )}

      <Card className="p-4">
        <TenderFilters employees={employees} />
      </Card>

      <Card>
        <TenderList
          tenders={tenders}
          emptyTitle="No tenders match these filters"
          emptyDescription={
            readOnly
              ? 'The Tender department has not logged a tender matching these filters.'
              : 'Clear a filter, or add a tender to start tracking a submission deadline.'
          }
        />
      </Card>
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
