import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, StatCard } from '@/components/ui/primitives'
import { TenderList, type TenderRow } from '@/components/tender/TenderList/TenderList'
import { TenderFilters } from '@/components/tender/TenderList/TenderFilters'
import { getTenderEmployees } from '@/lib/tender/queries'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { isTenderOverdue } from '@/lib/format'

export const dynamic = 'force-dynamic'

const TENDER_SELECT =
  'id, organization_id, title, issuing_authority, tender_number, description, submission_deadline, status, estimated_value, created_by, assigned_employee_id, created_at, updated_at, assignee:users!tenders_assigned_employee_id_fkey(full_name)'

export default async function TendersPage(props: PageProps<'/tenders'>) {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TENDER_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const statusFilter = asString(searchParams.status)
  const assigneeFilter = asString(searchParams.assignee)
  const overdueOnly = asString(searchParams.overdue) === '1'

  const supabase = await createSupabaseServerClient()

  // Deadline ascending: the tender closing soonest is the one that matters.
  let query = supabase
    .from('tenders')
    .select(TENDER_SELECT)
    .eq('organization_id', user.organization_id)
    .order('submission_deadline', { ascending: true })
    .limit(300)

  if (statusFilter) query = query.eq('status', statusFilter)
  if (assigneeFilter === 'unassigned') query = query.is('assigned_employee_id', null)
  else if (assigneeFilter) query = query.eq('assigned_employee_id', assigneeFilter)

  const [{ data: tenderData }, employees] = await Promise.all([
    query,
    getTenderEmployees(user.organization_id),
  ])

  let tenders = (tenderData ?? []) as unknown as TenderRow[]

  // Overdue is derived, so it is filtered here rather than in SQL — there is no
  // stored flag to query against.
  if (overdueOnly) tenders = tenders.filter(isTenderOverdue)

  const overdueCount = tenders.filter(isTenderOverdue).length
  const openCount = tenders.filter((t) => t.status === 'open').length
  const preparingCount = tenders.filter((t) => t.status === 'preparing_bid').length
  const submittedCount = tenders.filter((t) => t.status === 'submitted').length

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Tenders</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            <span>{tenders.length} total</span>
            {overdueCount > 0 && (
              <>
                <span>·</span>
                <span className="font-medium text-status-danger">{overdueCount} overdue</span>
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={openCount} />
        <StatCard label="Preparing Bid" value={preparingCount} />
        <StatCard label="Submitted" value={submittedCount} tone="success" />
        <StatCard
          label="Overdue"
          value={overdueCount}
          tone={overdueCount > 0 ? 'danger' : 'default'}
          hint="Past deadline, not yet submitted"
        />
      </div>

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
