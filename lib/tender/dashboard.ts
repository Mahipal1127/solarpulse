import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isTenderOverdue } from '@/lib/format'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import type { Tender, TenderBid, TenderStatus, Task } from '@/lib/types'

/**
 * Read-side aggregations for the Tender module.
 *
 * WHY THIS FILE EXISTS
 * The counts it returns were previously derived in three separate places — the
 * department's /tenders page, the CEO's department drill-down, and the AI context
 * builder — and two of those were already wrong in different ways. Distribution and
 * Technical each solved this with a module-level dashboard file for exactly this
 * reason: overdue is computed from the clock, so re-deriving it per caller is how
 * the CEO's number and the department's number drift apart. This is the tender
 * equivalent, and it is the single description of "how many tenders are late".
 *
 * Every query runs on the session client, so RLS decides which rows come back. None
 * of these functions takes a "which user" filter: this module has no per-employee
 * tier — a tender is departmental work, and every Tender member sees the same board
 * (see the tender_dept_access_* policies in migration 0003). Adding an owner filter
 * would move an access decision into application code and would mask a policy
 * regression rather than expose it.
 *
 * MONEY ARRIVES AS A STRING
 * estimated_value and bid_amount are numeric(14,2), which supabase-js returns as a
 * string to avoid float precision loss. Every total below therefore goes through
 * Number() before adding — `0 + "50000"` is `"050000"`, and a run of those produced
 * a "Value in play" figure on /bids that was off by orders of magnitude. This is the
 * same reason lib/distribution/dashboard.ts wraps total_amount.
 */

/** Statuses where a tender is still live work. Won/lost/cancelled are closed. */
const ACTIVE_STATUSES: TenderStatus[] = ['open', 'preparing_bid', 'submitted']

/**
 * Still needs submitting — the only statuses for which a deadline is a thing to act
 * on.
 *
 * Deliberately excludes 'submitted', which is active but done with its deadline: the
 * bid is in, and the date passing afterwards is the normal course of events rather
 * than a problem. This is the same rule isTenderOverdue() applies (submitted is in
 * its TENDER_CLOSED set) and the reason deadlineCountdown() returns null for it.
 * Getting this wrong in either direction is loud: counting submitted tenders as
 * late invents a crisis, and leaving them out of "active" would understate the
 * department's workload.
 */
const AWAITING_SUBMISSION: TenderStatus[] = ['open', 'preparing_bid']

/** How soon "closing soon" is. A working week — long enough to still act. */
export const CLOSING_SOON_DAYS = 7

/**
 * The row cap on every list read here.
 *
 * High enough that no real Tender department reaches it, and identical to the cap
 * Distribution uses. Where a count could be affected by it, the summary reports
 * `capped` so the page can say the figure covers what it can see rather than
 * presenting a truncated total as fact.
 */
const ROW_CAP = 500

/** numeric(14,2) → number. Null and unparseable both become 0. */
function money(raw: unknown): number {
  if (raw === null || raw === undefined) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

export type TenderWithAssignee = Tender & { assignee: { full_name: string } | null }

export interface TenderSummary {
  /**
   * Every tender RLS returned, for callers that need to group or filter rather
   * than count. The lists below are views over this array, not extra queries.
   */
  all: TenderWithAssignee[]
  total: number
  active: number
  open: number
  preparingBid: number
  submitted: number
  won: number
  lost: number
  cancelled: number
  /** Past the submission deadline and never submitted. Derived, never stored. */
  overdue: TenderWithAssignee[]
  /** Active, deadline inside CLOSING_SOON_DAYS, soonest first. */
  closingSoon: TenderWithAssignee[]
  /** Active with nobody named — the queue that stalls quietly. */
  unassigned: TenderWithAssignee[]
  /** Estimated value of active tenders. What is in play, not what was won. */
  pipelineValue: number
  /** Estimated value of tenders marked won. */
  wonValue: number
  /** Active tenders, soonest deadline first — the working queue. */
  upcoming: TenderWithAssignee[]
  /** True when ROW_CAP was hit, so counts describe a truncated read. */
  capped: boolean
}

export async function getTenderSummary(organizationId: string): Promise<TenderSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('tenders')
    .select('*, assignee:users!tenders_assigned_employee_id_fkey(full_name)')
    .eq('organization_id', organizationId)
    .order('submission_deadline', { ascending: true })
    .limit(ROW_CAP)

  const tenders = (data ?? []) as unknown as TenderWithAssignee[]
  const active = tenders.filter((t) => ACTIVE_STATUSES.includes(t.status))

  const horizon = Date.now() + CLOSING_SOON_DAYS * 86_400_000

  const count = (status: TenderStatus) => tenders.filter((t) => t.status === status).length

  return {
    all: tenders,
    total: tenders.length,
    active: active.length,
    open: count('open'),
    preparingBid: count('preparing_bid'),
    submitted: count('submitted'),
    won: count('won'),
    lost: count('lost'),
    cancelled: count('cancelled'),
    overdue: tenders.filter(isTenderOverdue),
    /*
     * Not yet overdue, but due within the week. Excludes the already-late ones on
     * purpose: those are reported separately and more urgently, and a tender
     * appearing in both lists would be counted twice by anyone adding them up.
     */
    closingSoon: tenders.filter((t) => {
      // Not `active`: a submitted tender's deadline is already met, so it is not
      // something closing that anyone has to act on.
      if (!AWAITING_SUBMISSION.includes(t.status)) return false
      if (isTenderOverdue(t)) return false
      return new Date(t.submission_deadline).getTime() <= horizon
    }),
    unassigned: active.filter((t) => t.assigned_employee_id === null),
    pipelineValue: active.reduce((sum, t) => sum + money(t.estimated_value), 0),
    wonValue: tenders
      .filter((t) => t.status === 'won')
      .reduce((sum, t) => sum + money(t.estimated_value), 0),
    // Already deadline-ascending from the query, so no re-sort.
    upcoming: active.slice(0, 8),
    capped: tenders.length === ROW_CAP,
  }
}

export type BidWithContext = TenderBid & {
  tenders: { id: string; title: string; status: string } | null
  assignee: { full_name: string } | null
}

export interface BidSummary {
  all: BidWithContext[]
  total: number
  draft: number
  /** Submitted or under review — out with the authority, awaiting an outcome. */
  inPlay: number
  won: number
  lost: number
  /** Value of every bid except the lost ones. */
  valueInPlay: number
  /** Value of bids marked won. */
  wonValue: number
  capped: boolean
}

export async function getBidSummary(): Promise<BidSummary> {
  const supabase = await createSupabaseServerClient()

  /*
   * No organization_id filter: tender_bids has no such column. RLS scopes the rows
   * through the parent tender (see tender_dept_access_tender_bids in 0003), and the
   * !inner join means a bid whose tender is invisible does not come back at all.
   */
  const { data } = await supabase
    .from('tender_bids')
    .select(
      '*, tenders!inner(id, title, status), assignee:users!tender_bids_assigned_employee_id_fkey(full_name)'
    )
    .order('created_at', { ascending: false })
    .limit(ROW_CAP)

  const bids = (data ?? []) as unknown as BidWithContext[]

  const inPlay = bids.filter(
    (b) => b.bid_status === 'submitted' || b.bid_status === 'under_review'
  )

  return {
    all: bids,
    total: bids.length,
    draft: bids.filter((b) => b.bid_status === 'draft').length,
    inPlay: inPlay.length,
    won: bids.filter((b) => b.bid_status === 'won').length,
    lost: bids.filter((b) => b.bid_status === 'lost').length,
    valueInPlay: bids
      .filter((b) => b.bid_status !== 'lost')
      .reduce((sum, b) => sum + money(b.bid_amount), 0),
    wonValue: bids
      .filter((b) => b.bid_status === 'won')
      .reduce((sum, b) => sum + money(b.bid_amount), 0),
    capped: bids.length === ROW_CAP,
  }
}

export type DepartmentTask = Task & {
  assignee: { full_name: string } | null
  creator: { full_name: string } | null
  department: { name: string } | null
}

/**
 * Tasks the CEO assigned to Tender without naming anyone.
 *
 * These were previously invisible everywhere in this module: /my-tasks filters on
 * assigned_user_id = me, so a task addressed to the department and to no one in
 * particular appeared on nobody's screen. Sales, Distribution and Technical all
 * surface them; this is the tender equivalent.
 *
 * The unowned filter is in the query rather than the caller, for the same reason
 * Technical's is: filtering after a limit would let owned tasks push the unowned
 * ones out of the result set, and a delegation queue that is empty when it should
 * not be is the failure nobody notices.
 *
 * Selects creator and department alongside assignee so the rows satisfy
 * AssignedTask, which the shared inbox expects.
 */
export async function getUnownedTenderTasks(
  organizationId: string,
  departmentId: string | null
): Promise<DepartmentTask[]> {
  if (!departmentId) return []

  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('tasks')
    .select(
      '*, assignee:users!tasks_assigned_user_id_fkey(full_name), creator:users!tasks_created_by_fkey(full_name), department:departments!tasks_assigned_department_id_fkey(name)'
    )
    .eq('organization_id', organizationId)
    .eq('assigned_department_id', departmentId)
    .is('assigned_user_id', null)
    .neq('status', 'archived')
    .order('due_date', { ascending: true, nullsFirst: false })

  return (data ?? []) as unknown as DepartmentTask[]
}

export { TENDER_DEPARTMENT_SLUG }
