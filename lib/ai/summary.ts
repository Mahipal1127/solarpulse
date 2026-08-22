import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAIConfig, recordUsage, requireUsableAI, AIUnavailableError } from '@/lib/ai/config'
import { isOverdue } from '@/lib/format'
import { getNetMeteringSummary, getSubsidySummary } from '@/lib/discom/dashboard'
import { getOutstandingInvoices } from '@/lib/finance/dashboard'
import { getLowStockLevels } from '@/lib/store/dashboard'
import type { SessionUser } from '@/lib/auth/guards'
import type { TaskStatus } from '@/lib/types'

/**
 * Today's summary. Every figure below is computed here from the database. The
 * AI is handed the finished numbers and asked only to phrase them — it is never
 * the source of a figure, so it cannot invent one.
 */

export interface SummaryFacts {
  date: string
  tasks: {
    total: number
    pending: number
    inProgress: number
    delayed: number
    completed: number
    overdue: number
    dueToday: number
    createdToday: number
    completedToday: number
  }
  approvals: {
    pending: number
    pendingOver48h: number
    decidedToday: number
  }
  departments: {
    reportingToday: number
    total: number
    delayedTaskTotal: number
    topDelayed: { name: string; delayed: number }[]
  }
  /**
   * Cross-department figures pulled from each module's own tables. Every field is
   * `number | null`: null means that source could not be read (a migration not applied
   * on this DB, or a policy denying it), NOT zero. The system prompt tells the model to
   * omit a null figure rather than report it as nothing happening — the same
   * missing-must-look-missing rule the CEO metrics and AwaitingModule states follow.
   */
  business: {
    /** Sales — deals closed today / in the last 7 days (deal_closures.closed_at). */
    dealsClosedToday: number | null
    dealsClosedThisWeek: number | null
    /** Technical — surveys marked completed today (status completed + updated today). */
    surveysCompletedToday: number | null
    /** O&M — open installations past their scheduled start date (computed, not stored). */
    installationsOverdue: number | null
    /** DISCOM — live net-metering + subsidy cases past the 15-day staleness threshold. */
    discomStaleCases: number | null
    /** Store — inventory items at or below their reorder threshold. */
    lowStockItems: number | null
    /** Finance — total balance outstanding on unsettled invoices, in INR. */
    outstandingReceivables: number | null
  }
}

export interface DailySummary {
  facts: SummaryFacts
  /** null when AI is off, unkeyed, over quota, or the call failed. */
  narrative: string | null
  narrativeUnavailableReason: string | null
}

export async function collectSummaryFacts(user: SessionUser): Promise<SummaryFacts> {
  const supabase = await createSupabaseServerClient()

  const now = new Date()
  const startOfDay = new Date(now)
  startOfDay.setHours(0, 0, 0, 0)
  const endOfDay = new Date(startOfDay)
  endOfDay.setDate(endOfDay.getDate() + 1)

  const startISO = startOfDay.toISOString()
  const endISO = endOfDay.toISOString()

  const [taskRes, approvalRes, departmentRes, reportRes] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, status, due_date, created_at, completed_at, assigned_department_id')
      .eq('organization_id', user.organization_id)
      .neq('status', 'archived')
      .limit(2000),
    supabase
      .from('approvals')
      .select('id, status, created_at, decided_at')
      .eq('organization_id', user.organization_id)
      .limit(2000),
    supabase
      .from('departments')
      .select('id, name')
      .eq('organization_id', user.organization_id),
    supabase
      .from('department_reports')
      .select('department_id, report_date')
      .gte('report_date', startISO.slice(0, 10))
      .limit(200),
  ])

  const tasks = (taskRes.data ?? []) as {
    id: string
    status: TaskStatus
    due_date: string | null
    created_at: string
    completed_at: string | null
    assigned_department_id: string
  }[]

  const counts = {
    total: tasks.length,
    pending: 0,
    inProgress: 0,
    delayed: 0,
    completed: 0,
    overdue: 0,
    dueToday: 0,
    createdToday: 0,
    completedToday: 0,
  }

  const delayedByDepartment = new Map<string, number>()

  for (const task of tasks) {
    if (task.status === 'pending') counts.pending += 1
    else if (task.status === 'in_progress') counts.inProgress += 1
    else if (task.status === 'delayed') counts.delayed += 1
    else if (task.status === 'completed') counts.completed += 1

    if (isOverdue({ due_date: task.due_date, status: task.status })) {
      counts.overdue += 1
      delayedByDepartment.set(
        task.assigned_department_id,
        (delayedByDepartment.get(task.assigned_department_id) ?? 0) + 1
      )
    }

    if (task.due_date && task.due_date >= startISO && task.due_date < endISO) counts.dueToday += 1
    if (task.created_at >= startISO) counts.createdToday += 1
    if (task.completed_at && task.completed_at >= startISO) counts.completedToday += 1
  }

  const approvals = (approvalRes.data ?? []) as {
    status: string
    created_at: string
    decided_at: string | null
  }[]

  const staleCutoff = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString()
  const approvalCounts = {
    pending: 0,
    pendingOver48h: 0,
    decidedToday: 0,
  }
  for (const approval of approvals) {
    if (approval.status === 'pending') {
      approvalCounts.pending += 1
      if (approval.created_at < staleCutoff) approvalCounts.pendingOver48h += 1
    }
    if (approval.decided_at && approval.decided_at >= startISO) approvalCounts.decidedToday += 1
  }

  const departments = (departmentRes.data ?? []) as { id: string; name: string }[]
  const departmentNames = new Map(departments.map((d) => [d.id, d.name]))
  const reportedToday = new Set((reportRes.data ?? []).map((r) => r.department_id))

  const topDelayed = [...delayedByDepartment.entries()]
    .map(([id, delayed]) => ({ name: departmentNames.get(id) ?? 'Unknown', delayed }))
    .sort((a, b) => b.delayed - a.delayed)
    .slice(0, 3)

  const business = await collectBusinessFacts(user, startISO)

  return {
    date: startISO.slice(0, 10),
    tasks: counts,
    approvals: approvalCounts,
    departments: {
      reportingToday: [...reportedToday].filter((id) => departmentNames.has(id)).length,
      total: departments.length,
      delayedTaskTotal: counts.overdue,
      topDelayed,
    },
    business,
  }
}

/**
 * Cross-department figures for the briefing, each read from the owning module's real
 * tables. Every source is isolated: it resolves to its number on success and to null
 * on ANY failure (an unapplied migration, a denied policy), so one missing module can
 * never blank the whole summary or turn a failed read into a false zero. DISCOM,
 * Finance and Store reuse their own module helpers rather than re-deriving thresholds.
 */
async function collectBusinessFacts(
  user: SessionUser,
  startISO: string
): Promise<SummaryFacts['business']> {
  const supabase = await createSupabaseServerClient()
  const orgId = user.organization_id
  const today = startISO.slice(0, 10)
  const weekAgoISO = new Date(new Date(startISO).getTime() - 6 * 86_400_000).toISOString()

  // Each entry is caught independently — Promise.all over already-safe promises.
  const [deals, surveys, installs, discom, lowStock, receivables] = await Promise.all([
    // Sales — deals closed today and over the last 7 days.
    (async (): Promise<{ today: number; week: number } | null> => {
      const { data, error } = await supabase
        .from('deal_closures')
        .select('closed_at, leads!inner(organization_id)')
        .eq('leads.organization_id', orgId)
        .gte('closed_at', weekAgoISO)
      if (error || !data) return null
      const rows = data as unknown as { closed_at: string }[]
      return {
        today: rows.filter((r) => r.closed_at >= startISO).length,
        week: rows.length,
      }
    })(),

    // Technical — surveys completed today. No completed_at column exists, so this
    // approximates completion by status 'completed' touched today (updated_at).
    (async (): Promise<number | null> => {
      const { count, error } = await supabase
        .from('site_surveys')
        .select('id', { count: 'exact', head: true })
        .eq('organization_id', orgId)
        .eq('status', 'completed')
        .gte('updated_at', startISO)
      return error ? null : count ?? 0
    })(),

    // O&M — open installations past their scheduled start date. Overdue is computed,
    // never stored (no helper exists for installations): an open-status install whose
    // scheduled_start_date is strictly before today. scheduled_start_date is a DATE,
    // so a string compare against today's date is exact and end-of-day correct.
    (async (): Promise<number | null> => {
      const { data, error } = await supabase
        .from('installations')
        .select('scheduled_start_date, status')
        .eq('organization_id', orgId)
        .in('status', ['assigned', 'in_progress', 'on_hold'])
      if (error || !data) return null
      const rows = data as { scheduled_start_date: string | null; status: string }[]
      return rows.filter(
        (r) => r.scheduled_start_date != null && r.scheduled_start_date < today
      ).length
    })(),

    // DISCOM — live cases past the 15-day staleness threshold, across both case types.
    // Reuses the module's own summaries, which apply isCaseStale / the shared threshold.
    (async (): Promise<number | null> => {
      try {
        const [nm, subsidy] = await Promise.all([
          getNetMeteringSummary(orgId),
          getSubsidySummary(orgId),
        ])
        return nm.stale + subsidy.stale
      } catch {
        return null
      }
    })(),

    // Store — items at or below reorder threshold. Reuses the low-stock helper.
    (async (): Promise<number | null> => {
      try {
        const levels = await getLowStockLevels()
        return levels.length
      } catch {
        return null
      }
    })(),

    // Finance — total balance outstanding on unsettled invoices. Reuses the same
    // helper the /outstanding page uses, summed to a single headline figure.
    (async (): Promise<number | null> => {
      try {
        const invoices = await getOutstandingInvoices()
        return invoices.reduce((total, inv) => total + inv.balance, 0)
      } catch {
        return null
      }
    })(),
  ])

  return {
    dealsClosedToday: deals ? deals.today : null,
    dealsClosedThisWeek: deals ? deals.week : null,
    surveysCompletedToday: surveys,
    installationsOverdue: installs,
    discomStaleCases: discom,
    lowStockItems: lowStock,
    outstandingReceivables: receivables,
  }
}

const SUMMARY_SYSTEM = `You write the daily briefing for the CEO of an Indian rooftop and commercial solar EPC company.

You will be given a JSON object of figures that were computed from the database. Rules:
- Use ONLY the figures given. Never introduce a number that is not in the JSON.
- If a figure is zero, you may say so plainly; do not speculate about why.
- Some figures under "business" may be null. Null means that department's data could not be read today — OMIT it entirely. Never describe a null as zero, "no activity", or "nothing happened"; simply do not mention it.
- The "business" figures cover Sales (deals closed), Technical (surveys completed), O&M (overdue installations), DISCOM (stale cases past 15 days), Store (low-stock items) and Finance (outstanding receivables, in INR). Report these as plain facts; do not editorialize beyond what the numbers say.
- 3 to 5 short sentences, plain prose, no bullet points, no headings, no greeting.
- Lead with whatever most deserves the CEO's attention today — an overdue or stale count usually outranks a healthy one.`

export async function buildDailySummary(user: SessionUser): Promise<DailySummary> {
  const facts = await collectSummaryFacts(user)

  let adapter
  const config = await loadAIConfig(user.organization_id)
  try {
    adapter = await requireUsableAI(config)
  } catch (err) {
    return {
      facts,
      narrative: null,
      narrativeUnavailableReason:
        err instanceof AIUnavailableError ? err.message : 'AI phrasing is unavailable.',
    }
  }

  try {
    const result = await adapter.complete({
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      maxTokens: 1024,
    })

    await recordUsage({
      config,
      userId: user.id,
      usage: result.usage,
      promptSummary: `Daily summary for ${facts.date}`,
    })

    if (result.refused || !result.text) {
      return { facts, narrative: null, narrativeUnavailableReason: 'The model declined to respond.' }
    }

    return { facts, narrative: result.text, narrativeUnavailableReason: null }
  } catch (err) {
    console.error('[ai] daily summary failed', err)
    return {
      facts,
      narrative: null,
      narrativeUnavailableReason: 'Could not reach the AI provider for phrasing.',
    }
  }
}
