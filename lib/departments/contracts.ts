import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { PendingDataSource } from '@/lib/types'

/**
 * Data the CEO analytics surface consumes but does not own. Each function reads the
 * owning department's real tables (the modules have since shipped) and the CEO's
 * `ceo_full_access_*` RLS policy grants the read.
 *
 * THE null CONTRACT IS DELIBERATE AND STILL LOAD-BEARING
 * A function returns null ONLY when its read fails — a migration not yet applied on
 * this database, or a policy denying the table. The UI turns null into an
 * "Awaiting <Department> module" state. That is different from a real zero, which is
 * a genuine count of nothing and renders as a number. So: catch the read, return null
 * on error, never coerce a failed read to 0. A missing number must look missing.
 *
 * Every status string below was confirmed against the migrated schema (recon pass),
 * because these tables mostly use text-with-comment columns where a typo'd filter
 * returns zero rows with no error.
 */

export interface RevenueSnapshot {
  monthToDate: number
  previousMonth: number
  currency: 'INR'
}

export interface AttendanceSnapshot {
  date: string
  presentCount: number
  totalCount: number
  percentPresent: number
}

export interface SalesTrendPoint {
  month: string
  revenue: number
  ordersWon: number
}

export interface ProjectPortfolio {
  active: number
  completed: number
  pending: number
}

/** One stage of the company-wide pipeline, for the cross-department funnel. */
export interface PipelineStage {
  /** Short label shown on the bar. */
  stage: string
  /** Live records sitting at this stage right now. */
  count: number
  /** Which department owns the stage — for the tooltip. */
  department: string
}

/** numeric columns can arrive from PostgREST as strings; coerce before summing. */
function toNumber(value: number | string | null | undefined): number {
  return value == null ? 0 : Number(value)
}

/**
 * Revenue = paid invoices, by the month the invoice was raised.
 *
 * `invoices` carries no explicit paid-date column (only created_at and due_date), so
 * a paid invoice is attributed to its issue month. For an internal MTD-vs-previous
 * headline that is the least-surprising reading available; a true cash-received view
 * would come from cash_flow_entries and is a separate metric. Uses total_amount
 * (the generated amount + gst_amount column). status 'paid' only — 'partially_paid'
 * is deliberately excluded so the figure means money fully collected.
 */
export async function getRevenueSnapshot(
  organizationId: string
): Promise<RevenueSnapshot | null> {
  const supabase = await createSupabaseServerClient()

  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  const { data, error } = await supabase
    .from('invoices')
    .select('total_amount, created_at')
    .eq('organization_id', organizationId)
    .eq('status', 'paid')
    .gte('created_at', prevMonthStart.toISOString())

  if (error || !data) return null

  const monthStartISO = monthStart.toISOString()
  let monthToDate = 0
  let previousMonth = 0
  for (const row of data as { total_amount: number | string | null; created_at: string }[]) {
    const amount = toNumber(row.total_amount)
    if (row.created_at >= monthStartISO) monthToDate += amount
    else previousMonth += amount
  }

  return { monthToDate, previousMonth, currency: 'INR' }
}

/**
 * Today's attendance. presentCount counts rows marked present or half-day for today;
 * totalCount is the active-employee headcount (the denominator the CEO expects — "X
 * of the team is in"), not the number of attendance rows, since an unmarked employee
 * has no row at all rather than an 'absent' one.
 *
 * `employees` has no organization_id of its own, so headcount scopes through the
 * linked users row (employees.user_id -> users.organization_id), the same path the
 * HR RLS helpers use.
 */
export async function getAttendanceSnapshot(
  organizationId: string
): Promise<AttendanceSnapshot | null> {
  const supabase = await createSupabaseServerClient()

  const today = new Date().toISOString().slice(0, 10)

  const [attendanceRes, headcountRes] = await Promise.all([
    supabase
      .from('attendance_records')
      .select('status, employees!inner(user_id, users!employees_user_id_fkey!inner(organization_id))')
      .eq('employees.users.organization_id', organizationId)
      .eq('date', today),
    supabase
      .from('employees')
      .select('id, employment_status, users!employees_user_id_fkey!inner(organization_id)', {
        count: 'exact',
        head: true,
      })
      .eq('users.organization_id', organizationId)
      .eq('employment_status', 'active'),
  ])

  if (attendanceRes.error || headcountRes.error) return null

  const records = (attendanceRes.data ?? []) as { status: string }[]
  const presentCount = records.filter(
    (r) => r.status === 'present' || r.status === 'half_day'
  ).length
  const totalCount = headcountRes.count ?? 0
  const percentPresent = totalCount > 0 ? (presentCount / totalCount) * 100 : 0

  return { date: today, presentCount, totalCount, percentPresent }
}

/**
 * Monthly sales over the last 12 months from deal_closures: summed final_amount and
 * a count of deals, per calendar month of closed_at. Returned oldest-first so the
 * chart's "highlight the last element" (current month) reads correctly.
 *
 * deal_closures has no organization_id column — it scopes through leads!inner, the
 * same reasoning as its own RLS policy (auth_lead_in_org).
 */
export async function getSalesTrend(organizationId: string): Promise<SalesTrendPoint[] | null> {
  const supabase = await createSupabaseServerClient()

  const now = new Date()
  // First day of the month 11 months ago — the start of the 12-month window.
  const windowStart = new Date(now.getFullYear(), now.getMonth() - 11, 1)

  const { data, error } = await supabase
    .from('deal_closures')
    .select('final_amount, closed_at, leads!inner(organization_id)')
    .eq('leads.organization_id', organizationId)
    .gte('closed_at', windowStart.toISOString())

  if (error || !data) return null

  // Pre-seed all 12 buckets so a quiet month shows as zero, not a gap.
  const buckets: { key: string; label: string; revenue: number; ordersWon: number }[] = []
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    buckets.push({
      key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`,
      label: d.toLocaleString('en-IN', { month: 'short' }),
      revenue: 0,
      ordersWon: 0,
    })
  }
  const byKey = new Map(buckets.map((b) => [b.key, b]))

  for (const row of data as { final_amount: number | string | null; closed_at: string }[]) {
    const bucket = byKey.get(row.closed_at.slice(0, 7))
    if (bucket) {
      bucket.revenue += toNumber(row.final_amount)
      bucket.ordersWon += 1
    }
  }

  return buckets.map((b) => ({ month: b.label, revenue: b.revenue, ordersWon: b.ordersWon }))
}

/**
 * Installation portfolio by lifecycle state. installation_status enum is
 * ['assigned','in_progress','completed','on_hold','cancelled'] (confirmed):
 *   pending   = assigned (accepted, not started)
 *   active    = in_progress + on_hold (live work, on_hold is still an open project)
 *   completed = completed
 * cancelled is excluded — it is not part of the portfolio.
 */
export async function getProjectPortfolio(
  organizationId: string
): Promise<ProjectPortfolio | null> {
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('installations')
    .select('status')
    .eq('organization_id', organizationId)

  if (error || !data) return null

  const rows = data as { status: string }[]
  return {
    pending: rows.filter((r) => r.status === 'assigned').length,
    active: rows.filter((r) => r.status === 'in_progress' || r.status === 'on_hold').length,
    completed: rows.filter((r) => r.status === 'completed').length,
  }
}

/**
 * The company-wide pipeline as a sequence of stage counts — the one genuinely new
 * cross-department view, since no single module sees the whole shape. Each stage
 * counts the LIVE records sitting there now (terminal/won/lost/completed excluded),
 * so the bars read as "work currently in flight at each hand-off".
 *
 * Reads five modules. If ANY of them errors (e.g. a migration not applied on this
 * DB), the whole funnel returns null and the UI shows the awaiting state rather than
 * a funnel with a silently-missing stage — a partial funnel would mislead.
 *
 * Stage order follows the real workflow: Sales lead -> Technical survey -> Technical
 * design -> O&M installation -> DISCOM net-metering -> DISCOM subsidy.
 */
export async function getPipelineFunnel(
  organizationId: string
): Promise<PipelineStage[] | null> {
  const supabase = await createSupabaseServerClient()

  const [leads, surveys, designs, installs, netMetering, subsidy] = await Promise.all([
    // Open leads — anything not won or lost.
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .not('status', 'in', '(won,lost)'),
    // Surveys still to do or underway.
    supabase
      .from('site_surveys')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('status', ['assigned', 'in_progress']),
    // Designs in progress — drafted or under review, not yet approved/handed off.
    // designs has no organization_id; scope through its parent survey.
    supabase
      .from('designs')
      .select('id, site_surveys!inner(organization_id)', { count: 'exact', head: true })
      .eq('site_surveys.organization_id', organizationId)
      .in('status', ['draft', 'under_review']),
    // Installations actively being built.
    supabase
      .from('installations')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .in('status', ['assigned', 'in_progress', 'on_hold']),
    // Net-metering applications not yet in a terminal state.
    supabase
      .from('net_metering_applications')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .not('status', 'in', '(approved,rejected)'),
    // Subsidy cases not yet disbursed or rejected.
    supabase
      .from('subsidy_cases')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
      .not('status', 'in', '(disbursed,rejected)'),
  ])

  const anyError =
    leads.error ||
    surveys.error ||
    designs.error ||
    installs.error ||
    netMetering.error ||
    subsidy.error
  if (anyError) return null

  return [
    { stage: 'Open leads', count: leads.count ?? 0, department: 'Sales' },
    { stage: 'Site surveys', count: surveys.count ?? 0, department: 'Technical' },
    { stage: 'Designs', count: designs.count ?? 0, department: 'Technical' },
    { stage: 'Installations', count: installs.count ?? 0, department: 'Operations & Maintenance' },
    { stage: 'Net metering', count: netMetering.count ?? 0, department: 'DISCOM' },
    { stage: 'Subsidy', count: subsidy.count ?? 0, department: 'DISCOM' },
  ]
}

export const PENDING_SOURCES: Record<string, PendingDataSource> = {
  revenue: { metric: 'Revenue', awaitingDepartment: 'Finance' },
  attendance: { metric: "Today's attendance", awaitingDepartment: 'HR' },
  salesTrend: { metric: 'Sales trend', awaitingDepartment: 'Sales' },
  projects: { metric: 'Project portfolio', awaitingDepartment: 'Technical' },
  pipeline: { metric: 'Company pipeline', awaitingDepartment: 'Sales' },
}
