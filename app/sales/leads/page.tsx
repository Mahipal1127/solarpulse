import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, StatCard } from '@/components/ui/primitives'
import { LeadPipeline, type LeadRow } from '@/components/sales/LeadPipeline/LeadPipeline'
import { LeadList } from '@/components/sales/LeadList/LeadList'
import { LeadFilters } from '@/components/sales/LeadList/LeadFilters'
import { getSalesEmployees } from '@/lib/sales/queries'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
import { LEAD_OPEN_STAGES } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Two FKs point from leads to users (assigned_to, assigned_by), so the join has
 * to name the constraint or Postgres cannot tell which relationship is meant.
 */
const LEAD_SELECT =
  'id, organization_id, name, phone, email, source, property_type, estimated_load_kw, status, assigned_to, assigned_by, notes, created_at, updated_at, assignee:users!leads_assigned_to_fkey(full_name)'

export default async function LeadsPage(props: PageProps<'/sales/leads'>) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  // A manager or the CEO sees whose lead is whose; an executive only ever gets
  // their own rows back from RLS, so an owner column would be one repeated name.
  const seesTeam = isSalesManager(user) || user.roleName === 'CEO'

  const view = asString(searchParams.view) === 'list' ? 'list' : 'board'
  const statusFilter = asString(searchParams.status)
  const sourceFilter = asString(searchParams.source)
  const ownerFilter = seesTeam ? asString(searchParams.owner) : undefined
  const openOnly = asString(searchParams.open) === '1'

  const supabase = await createSupabaseServerClient()

  // No .eq('assigned_to', user.id) here on purpose. Which leads come back is
  // RLS's decision: sales_exec_own_leads returns only the caller's rows, so an
  // executive filtering client-side is never what keeps a colleague's pipeline
  // hidden. Adding it would hide the bug if a policy ever regressed.
  let query = supabase
    .from('leads')
    .select(LEAD_SELECT)
    .eq('organization_id', user.organization_id)
    .order('created_at', { ascending: false })
    .limit(500)

  if (statusFilter) query = query.eq('status', statusFilter)
  else if (openOnly) query = query.in('status', LEAD_OPEN_STAGES)
  if (sourceFilter) query = query.eq('source', sourceFilter)
  if (ownerFilter === 'unassigned') query = query.is('assigned_to', null)
  else if (ownerFilter) query = query.eq('assigned_to', ownerFilter)

  const [{ data: leadData }, employees] = await Promise.all([
    query,
    seesTeam ? getSalesEmployees(user.organization_id) : Promise.resolve([]),
  ])

  const leads = (leadData ?? []) as unknown as LeadRow[]

  const openCount = leads.filter((l) => LEAD_OPEN_STAGES.includes(l.status)).length
  const negotiationCount = leads.filter((l) => l.status === 'negotiation').length
  const wonCount = leads.filter((l) => l.status === 'won').length
  const pipelineLoad = leads
    .filter((l) => LEAD_OPEN_STAGES.includes(l.status))
    .reduce((sum, l) => sum + (l.estimated_load_kw ?? 0), 0)

  const emptyDescription = readOnly
    ? 'The Sales department has not logged a lead matching these filters.'
    : seesTeam
      ? 'Clear a filter, or add a lead to start tracking it through the pipeline.'
      : 'Leads assigned to you appear here. Clear a filter, or add one.'

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {seesTeam ? 'Leads' : 'My Leads'}
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            <span>{leads.length} total</span>
            <span>·</span>
            <span>{openCount} still open</span>
          </div>
        </div>
        {!readOnly && (
          <Link
            href="/sales/leads/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + Add lead
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={openCount} hint="Not yet won or lost" />
        <StatCard
          label="In Negotiation"
          value={negotiationCount}
          tone={negotiationCount > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Won" value={wonCount} tone="success" />
        <StatCard
          label="Open Pipeline Load"
          value={`${round(pipelineLoad)} kW`}
          hint="Estimated, across open leads"
        />
      </div>

      <Card className="p-4">
        <LeadFilters employees={employees} view={view} />
      </Card>

      <Card>
        {view === 'board' ? (
          <LeadPipeline
            leads={leads}
            showAssignee={seesTeam}
            emptyTitle="No leads match these filters"
            emptyDescription={emptyDescription}
          />
        ) : (
          <LeadList
            leads={leads}
            showAssignee={seesTeam}
            emptyTitle="No leads match these filters"
            emptyDescription={emptyDescription}
          />
        )}
      </Card>
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

function round(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}
