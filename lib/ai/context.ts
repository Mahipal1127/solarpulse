import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { SessionUser } from '@/lib/auth/guards'

/**
 * Everything the assistant is allowed to know, gathered in one pass.
 *
 * ── WHY THIS USES THE RLS-BOUND CLIENT ─────────────────────────────────────
 * The previous context builder lived in the chat route and used the *service*
 * client, which bypasses row-level security entirely. That was survivable while it
 * read three tables the CEO could see anyway. Widening it to every module while
 * keeping the service client would have meant the assistant's reach was defined by
 * this file's WHERE clauses rather than by policy — and "RLS is the source of truth
 * for permissions" stops being true the moment the broadest reader in the app is
 * the one that ignores it.
 *
 * So every read below goes through createSupabaseServerClient(), which carries the
 * caller's session. The assistant can see exactly what the CEO can see through the
 * UI, no more, and if a policy is tightened later this narrows with it instead of
 * silently continuing to read.
 *
 * organization_id is still filtered explicitly on every table that has the column.
 * RLS is the boundary; the filter is what keeps the query correct for *this* org if
 * a policy is ever widened. Where a table has no organization_id of its own it
 * scopes through its parent — deal_closures through leads!inner, designs through
 * site_surveys!inner, department_reports through departments!inner — matching how
 * each table's own policy reasons about ownership.
 *
 * ── AGGREGATES, NOT ROW DUMPS ──────────────────────────────────────────────
 * Roughly forty tables are reachable. Serialising them would run to hundreds of
 * thousands of tokens per message, cost real money on every turn, and bury the
 * answer — a model given 2,000 rows reasons worse about "which department is
 * behind" than one given eleven counts. Counts and sums are what the questions are
 * actually about. Named rows appear only where a name is the answer: overdue tasks,
 * pending approvals, tenders closing this week.
 *
 * ── WHAT IS DELIBERATELY WITHHELD ──────────────────────────────────────────
 * Customer and lead phone numbers and email addresses. The prompt is sent to
 * whatever endpoint AI Settings names, which since the bring-your-own-key work can
 * be any gateway the CEO configured — so everything in here leaves the building and
 * lands on a third-party host. Counts of leads answer every question a CEO asks
 * about the pipeline; a contact list does not, and shipping personal contact details
 * to an arbitrary endpoint on every message is not a thing to do by accident. Names
 * are included because they are how a human refers to a deal.
 *
 * File paths are withheld too (layout_file_path, electricity_bill_file_path and the
 * rest) — they address private storage objects and are useless to a text model.
 */

export interface AIContextResult {
  /** The prompt block. */
  text: string
  /** Tables whose read failed, so the prompt can say so rather than imply zero. */
  unavailable: string[]
  /** True when any financial aggregate was successfully read — drives audit logging. */
  includedFinancials: boolean
}

/** `numeric` arrives as a string for large values; `+` on those concatenates. */
function sum(rows: Array<Record<string, unknown>>, key: string): number {
  return rows.reduce((total, row) => {
    const raw = row[key]
    return total + (raw === null || raw === undefined ? 0 : Number(raw) || 0)
  }, 0)
}

/** Indian-format money, whole rupees. Matches what the UI shows. */
function inr(value: number): string {
  return `₹${Math.round(value).toLocaleString('en-IN')}`
}

const ACTIVE_TENDER_STATUSES = ['open', 'preparing_bid', 'submitted']

/**
 * Still needs submitting. Narrower than ACTIVE_TENDER_STATUSES on purpose.
 *
 * A submitted tender is still active work — it is awaiting an outcome, so it counts
 * toward the active total and the pipeline value. But its deadline has been met, so a
 * date in the past is the normal course of events rather than a failure. Deriving
 * "late" from the wider list told the assistant that every tender submitted more than
 * a moment ago was PAST its deadline, which is the opposite of true and would have had
 * the CEO chasing work that was delivered on time — while the dashboard beside it
 * showed a different number, because isTenderOverdue() has always excluded submitted.
 * Mirrors AWAITING_SUBMISSION in lib/tender/dashboard.ts.
 */
const AWAITING_SUBMISSION_STATUSES = ['open', 'preparing_bid']
const OPEN_PO_STATUSES = [
  'draft',
  'pending_finance_approval',
  'approved',
  'ordered',
  'partially_received',
]

export async function buildAIContext(user: SessionUser): Promise<AIContextResult> {
  const supabase = await createSupabaseServerClient()
  const org = user.organization_id

  const now = new Date()
  const nowISO = now.toISOString()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  const weekAhead = new Date(now.getTime() + 7 * 86_400_000).toISOString()
  const today = nowISO.slice(0, 10)

  /*
   * One Promise.all rather than sequential awaits. These are independent reads and
   * a chat turn is interactive — serialising twenty round trips would put seconds
   * of latency in front of every reply.
   */
  const [
    tasks,
    departments,
    approvals,
    people,
    leads,
    closures,
    quotations,
    followUps,
    targets,
    tenders,
    purchaseOrders,
    vendors,
    dispatches,
    returns,
    surveys,
    designs,
    tickets,
    reports,
  ] = await Promise.all([
    // Named rows: a task is the unit the CEO talks about.
    supabase
      .from('tasks')
      .select(
        'title, status, priority, due_date, progress_percent, departments!tasks_assigned_department_id_fkey(name), assignee:users!tasks_assigned_user_id_fkey(full_name)'
      )
      .eq('organization_id', org)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(120),

    supabase.from('departments').select('name, slug').eq('organization_id', org),

    supabase
      .from('approvals')
      .select(
        'approval_type, status, created_at, notes, requester:users!approvals_requested_by_fkey(full_name), departments(name)'
      )
      .eq('organization_id', org)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(25),

    /*
     * Headcount by department, not a staff directory. `employees` has no
     * organization_id, so this reads `users` — which does — and joins the
     * designation across. is_active only: a former employee in the count makes
     * "who can take this on" wrong.
     */
    supabase
      .from('users')
      .select('full_name, departments(name), roles(name), employees(designation)')
      .eq('organization_id', org)
      .eq('is_active', true)
      .limit(200),

    supabase.from('leads').select('status, estimated_load_kw').eq('organization_id', org),

    // deal_closures has no organization_id — scoped through leads, as its own
    // policy does via auth_lead_in_org(lead_id).
    supabase
      .from('deal_closures')
      .select('final_amount, closed_at, leads!inner(organization_id)')
      .eq('leads.organization_id', org)
      .gte('closed_at', monthStart),

    supabase
      .from('quotations')
      .select('status, amount, leads!inner(organization_id)')
      .eq('leads.organization_id', org),

    supabase
      .from('follow_ups')
      .select('status, scheduled_for, type, leads!inner(organization_id, name)')
      .eq('leads.organization_id', org)
      .eq('status', 'pending')
      .limit(60),

    supabase
      .from('sales_targets')
      .select('target_amount, target_deals, period_start, period_end')
      .eq('organization_id', org)
      .lte('period_start', today)
      .gte('period_end', today),

    supabase
      .from('tenders')
      .select('title, status, submission_deadline, estimated_value, issuing_authority')
      .eq('organization_id', org)
      .order('submission_deadline', { ascending: true })
      .limit(60),

    supabase
      .from('purchase_orders')
      .select('po_number, status, total_amount, expected_delivery_date, vendors(name)')
      .eq('organization_id', org)
      .in('status', OPEN_PO_STATUSES)
      .limit(60),

    supabase
      .from('vendors')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', org)
      .eq('is_active', true),

    supabase.from('material_dispatches').select('status').eq('organization_id', org),

    supabase
      .from('material_returns')
      .select('status, condition, item_name, quantity')
      .eq('organization_id', org)
      .eq('status', 'pending')
      .limit(40),

    supabase
      .from('site_surveys')
      .select('status, scheduled_date')
      .eq('organization_id', org),

    // designs has no organization_id — through site_surveys, which does.
    supabase
      .from('designs')
      .select('status, system_size_kw, site_surveys!inner(organization_id)')
      .eq('site_surveys.organization_id', org),

    supabase
      .from('it_support_tickets')
      .select('status, issue_type, description, created_at')
      .eq('organization_id', org)
      .in('status', ['open', 'in_progress'])
      .limit(40),

    // department_reports has no organization_id — through departments.
    supabase
      .from('department_reports')
      .select(
        'report_date, summary, tasks_completed, tasks_pending, tasks_delayed, departments!inner(name, organization_id)'
      )
      .eq('departments.organization_id', org)
      .order('report_date', { ascending: false })
      .limit(12),
  ])

  /*
   * A failed read is named, never rendered as zero. "0 open purchase orders" and
   * "the Distribution module could not be read" lead to opposite decisions, and the
   * model cannot tell them apart unless it is told which happened — this is the same
   * reasoning as MetricAvailability in lib/ceo/metrics.ts.
   */
  const unavailable: string[] = []
  const ok = <T,>(result: { data: T | null; error: unknown }, label: string): T | null => {
    if (result.error) {
      unavailable.push(label)
      return null
    }
    return result.data
  }

  type Row = Record<string, unknown>
  const nameOf = (value: unknown): string =>
    (value as { name?: string } | null)?.name ?? 'Unassigned'

  const taskRows = (ok(tasks, 'tasks') ?? []) as Row[]
  const deptRows = (ok(departments, 'departments') ?? []) as Row[]
  const approvalRows = (ok(approvals, 'approvals') ?? []) as Row[]
  const peopleRows = (ok(people, 'people') ?? []) as Row[]
  const leadRows = (ok(leads, 'leads') ?? []) as Row[]
  const closureRows = (ok(closures, 'deal closures') ?? []) as Row[]
  const quotationRows = (ok(quotations, 'quotations') ?? []) as Row[]
  const followUpRows = (ok(followUps, 'follow-ups') ?? []) as Row[]
  const targetRows = (ok(targets, 'sales targets') ?? []) as Row[]
  const tenderRows = (ok(tenders, 'tenders') ?? []) as Row[]
  const poRows = (ok(purchaseOrders, 'purchase orders') ?? []) as Row[]
  const dispatchRows = (ok(dispatches, 'dispatches') ?? []) as Row[]
  const returnRows = (ok(returns, 'material returns') ?? []) as Row[]
  const surveyRows = (ok(surveys, 'site surveys') ?? []) as Row[]
  const designRows = (ok(designs, 'designs') ?? []) as Row[]
  const ticketRows = (ok(tickets, 'IT tickets') ?? []) as Row[]
  const reportRows = (ok(reports, 'department reports') ?? []) as Row[]
  if (vendors.error) unavailable.push('vendors')

  const lines: string[] = []
  const section = (title: string) => lines.push('', `## ${title}`)
  const count = (rows: Row[], key: string, value: string) =>
    rows.filter((row) => row[key] === value).length

  lines.push(`Today: ${today}. Organisation: ${user.organization_id}.`)
  lines.push(`Signed in as: ${user.full_name} (${user.roleName}).`)

  // ── Tasks ────────────────────────────────────────────────────────────────
  section('Tasks')
  const overdue = taskRows.filter(
    (row) =>
      typeof row.due_date === 'string' &&
      row.due_date < nowISO &&
      row.status !== 'completed' &&
      row.status !== 'archived'
  )
  lines.push(
    `${taskRows.length} active (excludes archived; capped at 120 soonest-due). ` +
      `pending ${count(taskRows, 'status', 'pending')}, ` +
      `in_progress ${count(taskRows, 'status', 'in_progress')}, ` +
      `delayed ${count(taskRows, 'status', 'delayed')}, ` +
      `completed ${count(taskRows, 'status', 'completed')}, ` +
      `overdue ${overdue.length}.`
  )
  if (overdue.length > 0) {
    lines.push('Overdue:')
    for (const row of overdue.slice(0, 25)) {
      lines.push(
        `  - "${row.title}" | ${nameOf(row.departments)} | ${nameOf(row.assignee) === 'Unassigned' ? 'unassigned' : (row.assignee as { full_name: string }).full_name} | due ${String(row.due_date).slice(0, 10)} | ${row.priority} | ${row.progress_percent}%`
      )
    }
  }
  const liveTasks = taskRows.filter((row) => row.status !== 'completed')
  if (liveTasks.length > 0) {
    lines.push('Open tasks (not completed):')
    for (const row of liveTasks.slice(0, 45)) {
      lines.push(
        `  - "${row.title}" | ${nameOf(row.departments)} | ${nameOf(row.assignee) === 'Unassigned' ? 'unassigned' : (row.assignee as { full_name: string }).full_name} | ${row.status}/${row.priority} | due ${row.due_date ? String(row.due_date).slice(0, 10) : 'none'} | ${row.progress_percent}%`
      )
    }
  }

  // ── Organisation ─────────────────────────────────────────────────────────
  section('Departments and people')
  lines.push(
    `Departments: ${deptRows.map((row) => row.name).join(', ') || 'none'}.`
  )
  const byDept = new Map<string, number>()
  for (const row of peopleRows) {
    const key = nameOf(row.departments)
    byDept.set(key, (byDept.get(key) ?? 0) + 1)
  }
  lines.push(
    `${peopleRows.length} active people — ${[...byDept.entries()].map(([name, n]) => `${name}: ${n}`).join(', ') || 'none'}.`
  )
  /*
   * Names with their department, so the assistant can resolve "assign this to
   * Priya" against a real person. No phone, email or joining date: none of that
   * helps answer a question, and all of it would be shipped to the configured
   * provider on every single turn.
   */
  if (peopleRows.length > 0) {
    lines.push('People (for assignment — exact names):')
    for (const row of peopleRows.slice(0, 60)) {
      const designation = (row.employees as { designation?: string } | null)?.designation
      lines.push(
        `  - ${row.full_name} | ${nameOf(row.departments)} | ${nameOf(row.roles)}${designation ? ` | ${designation}` : ''}`
      )
    }
  }

  // ── Approvals ────────────────────────────────────────────────────────────
  section('Pending approvals')
  if (approvalRows.length === 0) {
    lines.push('None pending.')
  } else {
    lines.push(`${approvalRows.length} awaiting the CEO, oldest first:`)
    for (const row of approvalRows) {
      const ageDays = Math.floor(
        (now.getTime() - new Date(String(row.created_at)).getTime()) / 86_400_000
      )
      lines.push(
        `  - ${row.approval_type} from ${(row.requester as { full_name?: string } | null)?.full_name ?? 'unknown'} (${nameOf(row.departments)}), waiting ${ageDays}d${row.notes ? ` — ${String(row.notes).slice(0, 120)}` : ''}`
      )
    }
  }

  // ── Sales ────────────────────────────────────────────────────────────────
  section('Sales')
  const openLeads = leadRows.filter((row) => row.status !== 'won' && row.status !== 'lost')
  const revenueMonth = sum(closureRows, 'final_amount')
  lines.push(
    `${leadRows.length} leads total, ${openLeads.length} still open. ` +
      `Won ${count(leadRows, 'status', 'won')}, lost ${count(leadRows, 'status', 'lost')}.`
  )
  lines.push(
    `Revenue this month: ${inr(revenueMonth)} across ${closureRows.length} closed deals.`
  )
  const quoteValue = sum(
    quotationRows.filter((row) => row.status === 'sent' || row.status === 'draft'),
    'amount'
  )
  lines.push(
    `Quotations: ${quotationRows.length} total, ${count(quotationRows, 'status', 'sent')} sent, ` +
      `${count(quotationRows, 'status', 'accepted')} accepted. Open quoted value ${inr(quoteValue)}.`
  )
  if (targetRows.length > 0) {
    const targetTotal = sum(targetRows, 'target_amount')
    lines.push(
      `Sales targets for the current period: ${inr(targetTotal)} across ${targetRows.length} people. ` +
        `Month-to-date achieved ${inr(revenueMonth)} (${targetTotal > 0 ? Math.round((revenueMonth / targetTotal) * 100) : 0}%).`
    )
  }
  const overdueFollowUps = followUpRows.filter(
    (row) => typeof row.scheduled_for === 'string' && row.scheduled_for < nowISO
  )
  lines.push(
    `Follow-ups pending ${followUpRows.length}, of which ${overdueFollowUps.length} are past their scheduled time.`
  )
  if (overdueFollowUps.length > 0) {
    for (const row of overdueFollowUps.slice(0, 10)) {
      lines.push(
        `  - ${row.type} for lead "${(row.leads as { name?: string } | null)?.name ?? '?'}" was due ${String(row.scheduled_for).slice(0, 10)}`
      )
    }
  }

  // ── Tenders ──────────────────────────────────────────────────────────────
  section('Tenders')
  const activeTenders = tenderRows.filter((row) =>
    ACTIVE_TENDER_STATUSES.includes(String(row.status))
  )
  lines.push(
    `${activeTenders.length} active of ${tenderRows.length}. ` +
      `Won ${count(tenderRows, 'status', 'won')}, lost ${count(tenderRows, 'status', 'lost')}. ` +
      `Pipeline value ${inr(sum(activeTenders, 'estimated_value'))}.`
  )
  /*
   * Both lists below are drawn from the tenders that still have to be submitted, not
   * from every active one — a submitted bid is not closing and cannot be late.
   */
  const awaitingSubmission = tenderRows.filter((row) =>
    AWAITING_SUBMISSION_STATUSES.includes(String(row.status))
  )
  const closingSoon = awaitingSubmission.filter(
    (row) =>
      typeof row.submission_deadline === 'string' &&
      row.submission_deadline >= nowISO &&
      row.submission_deadline <= weekAhead
  )
  const lateTenders = awaitingSubmission.filter(
    (row) => typeof row.submission_deadline === 'string' && row.submission_deadline < nowISO
  )
  // Past deadline and past-due are different problems; conflating them hides the worse one.
  if (lateTenders.length > 0) {
    lines.push(`${lateTenders.length} active tenders are PAST their submission deadline:`)
    for (const row of lateTenders.slice(0, 10)) {
      lines.push(
        `  - "${row.title}" (${row.issuing_authority ?? 'unknown authority'}) deadline was ${String(row.submission_deadline).slice(0, 10)}, still ${row.status}`
      )
    }
  }
  if (closingSoon.length > 0) {
    lines.push(`Closing within 7 days:`)
    for (const row of closingSoon) {
      lines.push(
        `  - "${row.title}" (${row.issuing_authority ?? 'unknown authority'}) due ${String(row.submission_deadline).slice(0, 10)}, ${inr(Number(row.estimated_value) || 0)}, ${row.status}`
      )
    }
  }

  // ── Distribution ─────────────────────────────────────────────────────────
  section('Distribution and procurement')
  lines.push(
    `${poRows.length} open purchase orders worth ${inr(sum(poRows, 'total_amount'))}. ` +
      `Awaiting Finance approval: ${count(poRows, 'status', 'pending_finance_approval')}. ` +
      `${vendors.count ?? 0} active vendors.`
  )
  const awaitingFinance = poRows.filter((row) => row.status === 'pending_finance_approval')
  for (const row of awaitingFinance.slice(0, 12)) {
    lines.push(
      `  - ${row.po_number} | ${nameOf(row.vendors)} | ${inr(Number(row.total_amount) || 0)} | expected ${row.expected_delivery_date ?? 'no date'}`
    )
  }
  lines.push(
    `Dispatches: ${dispatchRows.length} total — ` +
      `preparing ${count(dispatchRows, 'status', 'preparing')}, ` +
      `in transit ${count(dispatchRows, 'status', 'in_transit')}, ` +
      `delivered ${count(dispatchRows, 'status', 'delivered')}.`
  )
  if (returnRows.length > 0) {
    lines.push(
      `${returnRows.length} material returns pending store receipt` +
        `${returnRows.filter((row) => row.condition !== 'good').length > 0 ? `, ${returnRows.filter((row) => row.condition !== 'good').length} damaged or unusable` : ''}.`
    )
  }

  // ── Technical ────────────────────────────────────────────────────────────
  section('Technical')
  lines.push(
    `Site surveys: ${surveyRows.length} total — ` +
      `assigned ${count(surveyRows, 'status', 'assigned')}, ` +
      `in progress ${count(surveyRows, 'status', 'in_progress')}, ` +
      `completed ${count(surveyRows, 'status', 'completed')}.`
  )
  lines.push(
    `Designs: ${designRows.length} total — ` +
      `draft ${count(designRows, 'status', 'draft')}, ` +
      `under review ${count(designRows, 'status', 'under_review')}, ` +
      `approved ${count(designRows, 'status', 'approved')}. ` +
      `Combined system size ${sum(designRows, 'system_size_kw').toFixed(1)} kW.`
  )
  lines.push(
    `IT support: ${ticketRows.length} open or in progress` +
      `${ticketRows.length > 0 ? ` — ${count(ticketRows, 'status', 'open')} open, ${count(ticketRows, 'status', 'in_progress')} being worked on` : ''}.`
  )
  for (const row of ticketRows.slice(0, 8)) {
    lines.push(
      `  - [${row.issue_type ?? 'other'}] ${String(row.description).slice(0, 100)} (${row.status})`
    )
  }

  // ── Department reports ───────────────────────────────────────────────────
  if (reportRows.length > 0) {
    section('Latest department reports')
    for (const row of reportRows) {
      lines.push(
        `  - ${nameOf(row.departments)} ${row.report_date}: ${row.tasks_completed} done, ${row.tasks_pending} pending, ${row.tasks_delayed} delayed${row.summary ? ` — ${String(row.summary).slice(0, 150)}` : ''}`
      )
    }
  }

  // ── Gaps ─────────────────────────────────────────────────────────────────
  section('Not available')
  const permanentGaps = [
    'Finance revenue ledger, expenses and payroll — no module exists.',
    'HR attendance and leave balances — no module exists.',
    'Salaries and personal documents — not stored anywhere in this database.',
  ]
  for (const gap of permanentGaps) lines.push(`  - ${gap}`)
  if (unavailable.length > 0) {
    lines.push(
      `  - These could not be read on this request, so treat them as UNKNOWN rather than zero: ${unavailable.join(', ')}.`
    )
  }
  lines.push(
    '  - Customer and lead contact details (phone, email) and stored file paths are withheld from this context by design.'
  )

  /*
   * Only true when a money figure was actually READ — rows in hand, not merely a
   * query that did not error. A read that RLS answers with zero rows (a department
   * employee's view of deal_closures, say) succeeds but includes nothing, and an
   * audit row claiming "financials accessed" for that turn would be a false
   * statement. Drives the audit row in the chat route.
   */
  const includedFinancials =
    closureRows.length > 0 || quotationRows.length > 0 || poRows.length > 0 || tenderRows.length > 0

  return { text: lines.join('\n'), unavailable, includedFinancials }
}
