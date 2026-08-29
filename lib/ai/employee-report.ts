import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAIConfig, recordUsage, requireUsableAI, AIUnavailableError } from '@/lib/ai/config'
import { periodRange } from '@/lib/services/employee-reports'
import { isOverdue } from '@/lib/format'
import type { SessionUser } from '@/lib/auth/guards'
import type { ReportPeriod, TaskStatus } from '@/lib/types'

/**
 * The AI draft for an employee's own periodic report.
 *
 * Every figure below is computed here from the database. The AI is handed the finished
 * numbers and asked only to phrase them — it is never the source of a figure, so it
 * cannot invent one. This is the same rule lib/ai/summary.ts states for the CEO
 * briefing, and it matters more here: this text is submitted under a real person's name
 * and read by the CEO as that person's account of their own work. A hallucinated
 * "closed 4 deals" would be a false claim attributed to an employee.
 *
 * WHAT THE MODEL IS ALLOWED TO SEE. Only rows the employee themselves owns — assigned
 * tasks, their own progress notes, their own approval requests, and their own
 * department's records keyed on their user id. Every query runs through the RLS client
 * as the employee, so the draft can never contain something they could not already read.
 *
 * NULL MEANS "COULD NOT BE READ", NOT ZERO. Each department source is isolated and
 * resolves to null on any failure — an unapplied migration, a policy refusal. The system
 * prompt tells the model to omit a null entirely, never to report it as "no activity".
 * Getting this backwards would put "did no work this week" in someone's appraisal record.
 */

export interface DepartmentFacts {
  /** The department's slug, so the model can name the area of work. */
  module: string
  /**
   * Named counts, built from whatever status values the rows actually carry rather than
   * from a hardcoded enum list. If a status value is renamed in a later migration this
   * keeps reporting the truth instead of silently counting zero.
   */
  metrics: Record<string, number>
}

export interface EmployeeReportFacts {
  employee: { name: string; role: string; department: string | null }
  period: { label: ReportPeriod; start: string; end: string; days: number }
  tasks: {
    assignedTotal: number
    openNow: number
    overdueNow: number
    completedInPeriod: number
    assignedInPeriod: number
    dueInPeriod: number
    averageProgressOnOpen: number
    byStatus: Record<string, number>
  }
  /**
   * Concrete work to name in the prose. Titles and notes are real database strings, not
   * figures — handing them over is what turns "completed 3 tasks" into a report that says
   * which three. The ban is on inventing numbers, not on quoting stored text.
   */
  highlights: {
    completed: string[]
    open: { title: string; status: string; progress: number; dueDate: string | null }[]
    notes: string[]
  }
  approvals: { raisedInPeriod: number; stillPending: number } | null
  department: DepartmentFacts | null
}

export interface EmployeeReportDraft {
  facts: EmployeeReportFacts
  /** null when AI is off, unkeyed, over quota, or the call failed. */
  draft: string | null
  unavailableReason: string | null
}

const DAY_MS = 86_400_000

/** Inclusive DATE strings → the half-open timestamptz window a query needs. */
function windowFor(period: ReportPeriod) {
  const { start, end } = periodRange(period)
  const startISO = `${start}T00:00:00.000Z`
  const endExclusiveISO = new Date(new Date(`${end}T00:00:00.000Z`).getTime() + DAY_MS).toISOString()
  const days = Math.round((new Date(`${end}T00:00:00.000Z`).getTime() - new Date(startISO).getTime()) / DAY_MS) + 1
  return { start, end, startISO, endExclusiveISO, days }
}

/** Counts rows by their raw status string. No enum values are assumed anywhere. */
function tally(rows: { status?: string | null }[], prefix: string): Record<string, number> {
  const out: Record<string, number> = {}
  for (const row of rows) {
    const key = `${prefix}_${row.status ?? 'unknown'}`
    out[key] = (out[key] ?? 0) + 1
  }
  return out
}

export async function collectEmployeeReportFacts(
  user: SessionUser,
  period: ReportPeriod
): Promise<EmployeeReportFacts> {
  const supabase = await createSupabaseServerClient()
  const win = windowFor(period)

  const [taskRes, updateRes, approvalRes, department] = await Promise.all([
    // Tasks are universal — every department works through them, so this is the one
    // section of the draft that is never empty for anyone.
    supabase
      .from('tasks')
      .select('id, title, status, priority, due_date, progress_percent, created_at, updated_at')
      .eq('assigned_user_id', user.id)
      .neq('status', 'archived')
      .order('updated_at', { ascending: false })
      .limit(400),

    // Their own progress notes inside the window: the closest thing the database has to
    // the employee's own words about their week.
    supabase
      .from('task_updates')
      .select('note, created_at, tasks!inner(title)')
      .eq('updated_by', user.id)
      .gte('created_at', win.startISO)
      .lt('created_at', win.endExclusiveISO)
      .order('created_at', { ascending: false })
      .limit(60),

    supabase
      .from('approvals')
      .select('status, created_at')
      .eq('requested_by', user.id)
      .limit(300),

    collectDepartmentFacts(user, win),
  ])

  const tasks = (taskRes.data ?? []) as {
    id: string
    title: string
    status: TaskStatus
    due_date: string | null
    progress_percent: number
    created_at: string
    updated_at: string
  }[]

  if (taskRes.error) {
    console.error('[ai] report task read failed', taskRes.error.message)
  }

  const byStatus: Record<string, number> = {}
  const counts = {
    assignedTotal: tasks.length,
    openNow: 0,
    overdueNow: 0,
    completedInPeriod: 0,
    assignedInPeriod: 0,
    dueInPeriod: 0,
  }
  const completedTitles: string[] = []
  const openTasks: { title: string; status: string; progress: number; dueDate: string | null }[] = []
  let openProgressTotal = 0

  for (const task of tasks) {
    byStatus[task.status] = (byStatus[task.status] ?? 0) + 1

    if (task.status === 'completed') {
      // tasks has no completed_at column (only the CEO summary's query aliases one), so
      // "completed in this period" is approximated by a completed task touched inside the
      // window. Stated plainly rather than silently: the alternative is omitting completed
      // work from the report entirely, which is worse.
      if (task.updated_at >= win.startISO && task.updated_at < win.endExclusiveISO) {
        counts.completedInPeriod += 1
        if (completedTitles.length < 10) completedTitles.push(task.title)
      }
    } else {
      counts.openNow += 1
      openProgressTotal += task.progress_percent
      if (isOverdue({ due_date: task.due_date, status: task.status })) counts.overdueNow += 1
      if (openTasks.length < 10) {
        openTasks.push({
          title: task.title,
          status: task.status,
          progress: task.progress_percent,
          dueDate: task.due_date,
        })
      }
    }

    if (task.created_at >= win.startISO && task.created_at < win.endExclusiveISO) {
      counts.assignedInPeriod += 1
    }
    if (task.due_date && task.due_date >= win.startISO && task.due_date < win.endExclusiveISO) {
      counts.dueInPeriod += 1
    }
  }

  const noteRows = (updateRes.data ?? []) as unknown as {
    note: string | null
    tasks: { title: string } | null
  }[]
  const notes = noteRows
    .filter((row) => row.note?.trim())
    .slice(0, 15)
    .map((row) => (row.tasks?.title ? `${row.tasks.title}: ${row.note!.trim()}` : row.note!.trim()))

  let approvals: EmployeeReportFacts['approvals'] = null
  if (!approvalRes.error && approvalRes.data) {
    const rows = approvalRes.data as { status: string; created_at: string }[]
    approvals = {
      raisedInPeriod: rows.filter(
        (r) => r.created_at >= win.startISO && r.created_at < win.endExclusiveISO
      ).length,
      stillPending: rows.filter((r) => r.status === 'pending').length,
    }
  }

  return {
    employee: {
      name: user.full_name,
      role: user.roleName,
      department: user.departmentName,
    },
    period: { label: period, start: win.start, end: win.end, days: win.days },
    tasks: {
      ...counts,
      averageProgressOnOpen:
        counts.openNow > 0 ? Math.round(openProgressTotal / counts.openNow) : 0,
      byStatus,
    },
    highlights: { completed: completedTitles, open: openTasks, notes },
    approvals,
    department,
  }
}

/**
 * The employee's own records in their own department's tables.
 *
 * One branch per department, each keyed on the column that actually records ownership —
 * which differs per module and was read off the migrations, not guessed:
 * leads.assigned_to, net_metering_applications.assigned_to, content_calendar_items
 * .assigned_to, stock_movements.performed_by, site_surveys.assigned_engineer_id,
 * installations.team_lead_id, expenses.recorded_by, tenders.created_by,
 * purchase_orders.created_by.
 *
 * HR has no per-employee ownership column that belongs in a self-report (candidates and
 * interviews are the department's work, not one person's), so it returns null and the
 * report rests on the universal task facts. Same for anyone with no department.
 *
 * Wrapped in try/catch as a whole AND per source: a module whose migration was never
 * applied on this database must not break a report that is mostly about tasks.
 */
async function collectDepartmentFacts(
  user: SessionUser,
  win: { startISO: string; endExclusiveISO: string; start: string; end: string }
): Promise<DepartmentFacts | null> {
  const slug = user.departmentSlug
  if (!slug) return null

  const supabase = await createSupabaseServerClient()
  const orgId = user.organization_id

  /** Rows the employee owns, or null if the source could not be read at all. */
  const owned = async (
    table: string,
    columns: string,
    ownerColumn: string
  ): Promise<{ status?: string | null; created_at?: string }[] | null> => {
    try {
      const { data, error } = await supabase
        .from(table)
        .select(columns)
        .eq('organization_id', orgId)
        .eq(ownerColumn, user.id)
        .limit(500)
      if (error || !data) return null
      return data as unknown as { status?: string | null; created_at?: string }[]
    } catch {
      return null
    }
  }

  const inWindow = (rows: { created_at?: string }[]) =>
    rows.filter((r) => r.created_at && r.created_at >= win.startISO && r.created_at < win.endExclusiveISO)
      .length

  try {
    switch (slug) {
      case 'sales': {
        const [leads, closures] = await Promise.all([
          owned('leads', 'status, created_at', 'assigned_to'),
          // deal_closures has no organization_id and the owner column is closed_by, not
          // created_by — created_by on 0005 belongs to sales_targets. Scoped through the
          // parent lead's org instead.
          (async () => {
            const { data, error } = await supabase
              .from('deal_closures')
              .select('final_amount, closed_at, leads!inner(organization_id)')
              .eq('closed_by', user.id)
              .eq('leads.organization_id', orgId)
              .gte('closed_at', win.startISO)
              .lt('closed_at', win.endExclusiveISO)
            return error || !data ? null : (data as unknown as { final_amount: number }[])
          })(),
        ])
        if (!leads && !closures) return null
        return {
          module: 'sales',
          metrics: {
            ...(leads
              ? {
                  leads_owned: leads.length,
                  leads_received_in_period: inWindow(leads),
                  ...tally(leads, 'leads'),
                }
              : {}),
            ...(closures
              ? {
                  deals_closed_in_period: closures.length,
                  deal_value_closed_in_period_inr: closures.reduce(
                    (sum, c) => sum + Number(c.final_amount ?? 0),
                    0
                  ),
                }
              : {}),
          },
        }
      }

      case 'discom': {
        const [netMetering, subsidy] = await Promise.all([
          owned('net_metering_applications', 'status, created_at', 'assigned_to'),
          owned('subsidy_cases', 'status, created_at', 'assigned_to'),
        ])
        if (!netMetering && !subsidy) return null
        return {
          module: 'discom',
          metrics: {
            ...(netMetering
              ? {
                  net_metering_cases_owned: netMetering.length,
                  net_metering_opened_in_period: inWindow(netMetering),
                  ...tally(netMetering, 'net_metering'),
                }
              : {}),
            ...(subsidy
              ? {
                  subsidy_cases_owned: subsidy.length,
                  subsidy_opened_in_period: inWindow(subsidy),
                  ...tally(subsidy, 'subsidy'),
                }
              : {}),
          },
        }
      }

      case 'marketing-training': {
        const items = await owned('content_calendar_items', 'status, created_at', 'assigned_to')
        if (!items) return null
        return {
          module: 'marketing-training',
          metrics: {
            content_items_owned: items.length,
            content_items_added_in_period: inWindow(items),
            ...tally(items, 'content'),
          },
        }
      }

      case 'store': {
        const moves = await owned('stock_movements', 'movement_type, created_at', 'performed_by')
        if (!moves) return null
        const rows = moves as unknown as { movement_type: string; created_at: string }[]
        const inPeriod = rows.filter(
          (r) => r.created_at >= win.startISO && r.created_at < win.endExclusiveISO
        )
        const byType: Record<string, number> = {}
        for (const row of inPeriod) {
          byType[`movement_${row.movement_type}`] = (byType[`movement_${row.movement_type}`] ?? 0) + 1
        }
        return {
          module: 'store',
          metrics: {
            stock_movements_in_period: inPeriod.length,
            stock_movements_recorded_all_time: rows.length,
            ...byType,
          },
        }
      }

      case 'technical': {
        const [surveys, tickets] = await Promise.all([
          owned('site_surveys', 'status, created_at', 'assigned_engineer_id'),
          owned('it_support_tickets', 'status, created_at', 'assigned_to'),
        ])
        if (!surveys && !tickets) return null
        return {
          module: 'technical',
          metrics: {
            ...(surveys
              ? {
                  surveys_assigned: surveys.length,
                  surveys_assigned_in_period: inWindow(surveys),
                  ...tally(surveys, 'survey'),
                }
              : {}),
            ...(tickets
              ? {
                  it_tickets_assigned: tickets.length,
                  ...tally(tickets, 'it_ticket'),
                }
              : {}),
          },
        }
      }

      case 'operations-maintenance': {
        const [installs, tickets] = await Promise.all([
          owned('installations', 'status, created_at', 'team_lead_id'),
          owned('service_tickets', 'status, created_at', 'assigned_to'),
        ])
        if (!installs && !tickets) return null
        return {
          module: 'operations-maintenance',
          metrics: {
            ...(installs
              ? {
                  installations_led: installs.length,
                  installations_started_in_period: inWindow(installs),
                  ...tally(installs, 'installation'),
                }
              : {}),
            ...(tickets
              ? {
                  service_tickets_assigned: tickets.length,
                  ...tally(tickets, 'service_ticket'),
                }
              : {}),
          },
        }
      }

      case 'finance':
      case 'accounts': {
        // Expenses only, and only the count and total the employee themselves recorded.
        // Deliberately not salaries, appraisals or anyone else's figures — a self-report
        // is not a route around the money-field role checks.
        const { data, error } = await supabase
          .from('expenses')
          .select('amount, expense_date')
          .eq('organization_id', orgId)
          .eq('recorded_by', user.id)
          .gte('expense_date', win.start)
          .lte('expense_date', win.end)
          .limit(500)
        if (error || !data) return null
        const rows = data as { amount: number }[]
        return {
          module: 'finance',
          metrics: {
            expenses_recorded_in_period: rows.length,
            expense_value_recorded_in_period_inr: rows.reduce(
              (sum, r) => sum + Number(r.amount ?? 0),
              0
            ),
          },
        }
      }

      case 'tender': {
        const tenders = await owned('tenders', 'status, created_at', 'created_by')
        if (!tenders) return null
        return {
          module: 'tender',
          metrics: {
            tenders_created: tenders.length,
            tenders_created_in_period: inWindow(tenders),
            ...tally(tenders, 'tender'),
          },
        }
      }

      case 'distribution': {
        const orders = await owned('purchase_orders', 'status, created_at', 'created_by')
        if (!orders) return null
        return {
          module: 'distribution',
          metrics: {
            purchase_orders_raised: orders.length,
            purchase_orders_raised_in_period: inWindow(orders),
            ...tally(orders, 'po'),
          },
        }
      }

      default:
        return null
    }
  } catch (err) {
    console.error('[ai] department facts failed', slug, err)
    return null
  }
}

const REPORT_SYSTEM = `You draft an employee's own periodic work report at an Indian rooftop and commercial solar EPC company. The employee will read your draft, edit it, and submit it under their own name to their manager and the CEO.

You will be given a JSON object of figures and titles that were computed from the company database. Rules:
- Use ONLY what is in the JSON. Never introduce a number, name, customer, amount or achievement that is not there.
- Write in the FIRST PERSON, as the employee ("I completed...", "I am carrying..."). It is their report, not a description of them.
- Name specific work from "highlights" — the completed task titles, the open ones, and the employee's own progress notes. A report that names real work is worth more than one that only counts it.
- A null or missing field means that data could not be read, NOT that nothing happened. Omit it entirely. Never write "no activity", "nothing to report" or a zero for a field that is absent.
- A field that is genuinely 0 may be stated plainly. Do not speculate about why.
- "department" holds figures from the employee's own module, keyed by that module's own terms. Report them as plain facts.
- Amounts suffixed _inr are Indian rupees. Write them as ₹ figures.
- Be honest, not promotional. If work is overdue, say so and say what is being done about it if the notes show it; do not bury it or dress it up.
- Structure: a short opening line naming the period, then 2 to 4 short paragraphs — work completed, work in progress, and anything blocked or needing attention. Plain prose, no headings, no bullet points, no sign-off, no placeholders like [name].
- Do not invent a plan for next period unless the notes contain one.`

export async function buildEmployeeReportDraft(
  user: SessionUser,
  period: ReportPeriod
): Promise<EmployeeReportDraft> {
  const facts = await collectEmployeeReportFacts(user, period)

  let adapter
  const config = await loadAIConfig(user.organization_id)
  try {
    adapter = await requireUsableAI(config)
  } catch (err) {
    return {
      facts,
      draft: null,
      unavailableReason:
        err instanceof AIUnavailableError
          ? err.message
          : 'AI drafting is unavailable. Write your report yourself, or attach a file.',
    }
  }

  try {
    const result = await adapter.complete({
      system: REPORT_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      maxTokens: 1600,
    })

    await recordUsage({
      config,
      userId: user.id,
      usage: result.usage,
      promptSummary: `${period} report draft for ${facts.period.start} to ${facts.period.end}`,
    })

    if (result.refused || !result.text) {
      return { facts, draft: null, unavailableReason: 'The model declined to write a draft.' }
    }

    return { facts, draft: result.text, unavailableReason: null }
  } catch (err) {
    console.error('[ai] employee report draft failed', err)
    return {
      facts,
      draft: null,
      unavailableReason: 'Could not reach the AI provider. Write your report yourself, or attach a file.',
    }
  }
}
