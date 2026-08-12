import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Cross-department metrics for the CEO dashboard.
 *
 * WHY THESE ARE REAL AND `lib/departments/contracts.ts` IS STILL STUBBED
 * That file predates the Sales, Tender, Distribution and Technical migrations and
 * returns null for everything, so the UI renders "Awaiting <Department> module".
 * Those modules have since shipped with their own tables, and the CEO holds a
 * `ceo_full_access_*` policy on each. So the numbers below are counted from real
 * rows. The contracts file still covers what genuinely has no owner yet — Finance
 * revenue, HR attendance, a project registry — and keeps returning null for those.
 *
 * A ZERO HERE IS A REAL ZERO
 * Every figure is a count or a sum over tables the CEO can read. "0 open leads"
 * means the leads table holds none, not that the number is unknown. That is the
 * distinction the AwaitingModule state exists to make, and it is why these metrics
 * do not use it.
 *
 * SCOPING
 * Each query filters `organization_id` explicitly rather than leaning on RLS alone.
 * RLS is the boundary; the filter is what makes the query correct for *this* org if
 * a policy is ever widened. `deal_closures` has no `organization_id` column of its
 * own, so it scopes through `leads!inner` — its RLS policy uses the same lead-based
 * reasoning (`auth_lead_in_org(lead_id)`).
 */

/**
 * Set when a read failed — a migration not yet applied on this database, or a policy
 * denying the table outright.
 *
 * This exists because the alternative is worse than an error message: coercing a
 * failed read to 0 renders "0 open purchase orders", which a CEO cannot tell apart
 * from a real zero. A missing number has to look missing.
 */
export interface MetricAvailability {
  unavailable: boolean
}

export interface SalesMetrics extends MetricAvailability {
  /** Sum of final_amount on deals closed since the start of this month, in INR. */
  revenueThisMonth: number
  dealsClosedThisMonth: number
  /** Leads still in play — anything not yet won or lost. */
  openLeads: number
}

export interface TenderMetrics extends MetricAvailability {
  /** Tenders not yet resolved: open, preparing a bid, or submitted and awaiting a result. */
  activeTenders: number
  /** Active tenders whose submission deadline falls inside the next 7 days. */
  closingSoon: number
  /** Summed estimated_value of active tenders. Nulls count as zero, not as unknown. */
  pipelineValue: number
}

export interface DistributionMetrics extends MetricAvailability {
  awaitingFinanceApproval: number
  /** Purchase orders that are neither fully received nor cancelled. */
  openPurchaseOrders: number
  /** Summed total_amount of those open purchase orders. */
  openPurchaseOrderValue: number
}

export interface TechnicalMetrics extends MetricAvailability {
  /** Site surveys assigned or underway. */
  surveysInFlight: number
  openITTickets: number
}

export interface CrossDepartmentMetrics {
  sales: SalesMetrics
  tender: TenderMetrics
  distribution: DistributionMetrics
  technical: TechnicalMetrics
}

/** Statuses that mean a tender is still live. */
const ACTIVE_TENDER_STATUSES = ['open', 'preparing_bid', 'submitted']

/** A purchase order stops being "open" once it is fully received or cancelled. */
const OPEN_PO_STATUSES = [
  'draft',
  'pending_finance_approval',
  'approved',
  'ordered',
  'partially_received',
]

/**
 * `numeric` columns can arrive as strings for large values, so every money field is
 * coerced before summing. Without this, `+` would concatenate and a revenue figure
 * would silently become nonsense.
 */
function sum(rows: { value: number | string | null }[]): number {
  return rows.reduce((total, row) => total + (row.value === null ? 0 : Number(row.value)), 0)
}

export async function getCrossDepartmentMetrics(
  organizationId: string
): Promise<CrossDepartmentMetrics> {
  const supabase = await createSupabaseServerClient()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString()

  /*
   * Count-only reads use `head: true` so Postgres returns a count without shipping
   * rows. Sums have to fetch the amount column — PostgREST cannot aggregate without
   * an RPC — but each is narrowed to one column and an indexed status filter.
   */
  const [closures, openLeads, tenders, purchaseOrders, surveys, itTickets] = await Promise.all([
    supabase
      .from('deal_closures')
      .select('final_amount, leads!inner(organization_id)')
      .eq('leads.organization_id', organizationId)
      .gte('closed_at', monthStart),

    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .not('status', 'in', '(won,lost)'),

    supabase
      .from('tenders')
      .select('estimated_value, submission_deadline')
      .eq('organization_id', organizationId)
      .in('status', ACTIVE_TENDER_STATUSES),

    supabase
      .from('purchase_orders')
      .select('status, total_amount')
      .eq('organization_id', organizationId)
      .in('status', OPEN_PO_STATUSES),

    supabase
      .from('site_surveys')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('status', ['assigned', 'in_progress']),

    supabase
      .from('it_support_tickets')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('status', ['open', 'in_progress']),
  ])

  const closureRows = (closures.data ?? []) as unknown as { final_amount: number | string }[]
  const tenderRows = (tenders.data ?? []) as unknown as {
    estimated_value: number | string | null
    submission_deadline: string
  }[]
  const poRows = (purchaseOrders.data ?? []) as unknown as {
    status: string
    total_amount: number | string | null
  }[]

  const nowISO = now.toISOString()

  return {
    sales: {
      unavailable: Boolean(closures.error || openLeads.error),
      revenueThisMonth: sum(closureRows.map((row) => ({ value: row.final_amount }))),
      dealsClosedThisMonth: closureRows.length,
      openLeads: openLeads.count ?? 0,
    },
    tender: {
      unavailable: Boolean(tenders.error),
      activeTenders: tenderRows.length,
      // Deadline inside the next 7 days and not already past — an overdue tender is
      // a different problem from one closing soon, and conflating them would hide it.
      closingSoon: tenderRows.filter(
        (row) => row.submission_deadline >= nowISO && row.submission_deadline <= weekAhead
      ).length,
      pipelineValue: sum(tenderRows.map((row) => ({ value: row.estimated_value }))),
    },
    distribution: {
      unavailable: Boolean(purchaseOrders.error),
      awaitingFinanceApproval: poRows.filter((row) => row.status === 'pending_finance_approval')
        .length,
      openPurchaseOrders: poRows.length,
      openPurchaseOrderValue: sum(poRows.map((row) => ({ value: row.total_amount }))),
    },
    technical: {
      unavailable: Boolean(surveys.error || itTickets.error),
      surveysInFlight: surveys.count ?? 0,
      openITTickets: itTickets.count ?? 0,
    },
  }
}
