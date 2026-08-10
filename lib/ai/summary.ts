import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { loadAIConfig, recordUsage, requireUsableAI, AIUnavailableError } from '@/lib/ai/config'
import { isOverdue } from '@/lib/format'
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
  }
}

const SUMMARY_SYSTEM = `You write the daily briefing for the CEO of an Indian rooftop and commercial solar EPC company.

You will be given a JSON object of figures that were computed from the database. Rules:
- Use ONLY the figures given. Never introduce a number that is not in the JSON.
- If a figure is zero, you may say so plainly; do not speculate about why.
- Never speculate about revenue, headcount, or projects — those numbers are not in the JSON because the source systems are not connected yet.
- 3 to 5 short sentences, plain prose, no bullet points, no headings, no greeting.
- Lead with whatever most deserves the CEO's attention today.`

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
