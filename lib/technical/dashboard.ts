import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { isSurveyOverdue, isSurveyAwaitingSchedule } from '@/lib/format'
import { SURVEY_OPEN_STATUSES, DESIGN_WIP_STATUSES } from '@/lib/technical/constants'
import type { SiteSurvey, Design, ITSupportTicket, Task } from '@/lib/types'

/**
 * Read-side aggregations for the Technical dashboard.
 *
 * Every query runs on the session client, so RLS decides which rows come back, and
 * none of these functions takes a "which user" filter. That matters more here than it
 * did in Distribution: this module *does* have a per-employee tier — an engineer sees
 * their own surveys, a lead sees the department's — and it is enforced entirely by
 * policy. Passing a user id into these queries would put the same rule in a second
 * place, and the copy in application code is the one that drifts. Worse, it would mask
 * a policy regression instead of exposing it.
 *
 * The consequence to keep in mind when reading the callers: the same function returns
 * different row counts for an engineer and a lead, by design. Where the dashboard
 * wants "mine" specifically out of a lead's wider set, it filters in the page — a
 * display choice, clearly marked as such.
 *
 * Overdue and awaiting-schedule are computed from the same helpers the lists use,
 * never read from a stored flag: survey_status has no 'overdue' value by design.
 */

export type SurveyWithContext = SiteSurvey & {
  engineer: { full_name: string } | null
  /**
   * The lead's phone comes along because the handoff queue's whole action is
   * "ring the customer and agree a date" — without it that panel sends someone to
   * the survey page to find a number and back again. site_surveys has no address
   * column, so the lead's name is the only site identity available here.
   */
  lead: { name: string; phone: string | null } | null
}

export interface SurveySummary {
  /**
   * Every survey RLS handed back, for the caller that needs to group rather than
   * count — the team view's per-engineer workload, mainly. The categorised lists
   * below are views over this one array, not separate queries.
   */
  all: SurveyWithContext[]
  total: number
  open: number
  completed: number
  /**
   * Sales asked for a survey and nobody has put a date on it.
   *
   * Operationally the most important number in this module — it is the exact handoff
   * point the client flagged as a source of delay, which is why the dashboard leads
   * with the rows rather than just the count.
   */
  awaitingSchedule: SurveyWithContext[]
  overdue: SurveyWithContext[]
  /** Still outstanding, soonest scheduled first — what to do next. */
  upcoming: SurveyWithContext[]
}

export async function getSurveySummary(): Promise<SurveySummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('site_surveys')
    .select(
      '*, engineer:users!site_surveys_assigned_engineer_id_fkey(full_name), lead:leads(name, phone)'
    )
    .order('created_at', { ascending: false })
    .limit(500)

  const surveys = (data ?? []) as unknown as SurveyWithContext[]
  const open = surveys.filter((s) => SURVEY_OPEN_STATUSES.includes(s.status))

  return {
    all: surveys,
    total: surveys.length,
    open: open.length,
    completed: surveys.filter((s) => s.status === 'completed').length,
    awaitingSchedule: surveys.filter(isSurveyAwaitingSchedule),
    overdue: surveys.filter(isSurveyOverdue),
    /**
     * Dated and still open, soonest first. Undated surveys are deliberately absent:
     * they cannot be sorted into a schedule, and the ones that came from Sales are
     * already surfaced above as awaiting a date — which is a more urgent thing to say
     * about them than "sometime".
     */
    upcoming: open
      .filter((s) => s.scheduled_date !== null)
      .sort(
        (a, b) =>
          new Date(a.scheduled_date as string).getTime() -
          new Date(b.scheduled_date as string).getTime()
      )
      .slice(0, 8),
  }
}

export type DesignWithContext = Design & {
  designer: { full_name: string } | null
  survey: { id: string; assigned_engineer_id: string; lead: { name: string } | null } | null
}

export interface DesignSummary {
  total: number
  wip: DesignWithContext[]
  awaitingReview: number
  approved: number
  sentToSales: number
  /** Approved but not yet handed over — the queue that stalls quietly. */
  readyForSales: DesignWithContext[]
}

export async function getDesignSummary(): Promise<DesignSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('designs')
    .select(
      `*,
       designer:users!designs_designed_by_fkey(full_name),
       survey:site_surveys(id, assigned_engineer_id, lead:leads(name))`
    )
    .order('updated_at', { ascending: false })
    .limit(500)

  const designs = (data ?? []) as unknown as DesignWithContext[]

  return {
    total: designs.length,
    wip: designs.filter((d) => DESIGN_WIP_STATUSES.includes(d.status)),
    awaitingReview: designs.filter((d) => d.status === 'under_review').length,
    approved: designs.filter((d) => d.status === 'approved').length,
    sentToSales: designs.filter((d) => d.status === 'sent_to_sales').length,
    readyForSales: designs.filter((d) => d.status === 'approved').slice(0, 8),
  }
}

export interface TicketSummary {
  open: number
  inProgress: number
  unassigned: number
  recent: ITSupportTicket[]
}

export async function getTicketSummary(): Promise<TicketSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('it_support_tickets')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(300)

  const tickets = (data ?? []) as ITSupportTicket[]
  const open = tickets.filter((t) => t.status === 'open')

  return {
    open: open.length,
    inProgress: tickets.filter((t) => t.status === 'in_progress').length,
    unassigned: open.filter((t) => t.assigned_to === null).length,
    recent: tickets.filter((t) => t.status !== 'closed').slice(0, 5),
  }
}

export type DepartmentTask = Task & {
  assignee: { full_name: string } | null
  creator: { full_name: string } | null
  department: { name: string } | null
}

/**
 * Tasks the CEO assigned to Technical without naming anyone — the delegation inbox,
 * the same one Sales and Distribution carry. Read from `tasks` rather than
 * audit_logs, which is CEO-read-only by policy: a Technical employee would get an
 * empty panel from it and never learn why.
 *
 * The unowned filter is in the query, not in the caller. Filtering after a limit
 * would let twenty tasks with named owners push the unowned ones out of the result
 * set, and an empty delegation queue that should not be empty is the failure nobody
 * notices. Anything with an assigned_user_id already sits on that person's own
 * dashboard, and RLS keeps it out of a colleague's reach.
 *
 * Selects creator and department as well as assignee so the rows satisfy
 * AssignedTask, which the shared inbox and task board both expect.
 */
export async function getUnownedDepartmentTasks(
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

/**
 * The Technical department's id, needed to scope the CEO-assigned task queries.
 *
 * Looked up by slug rather than read off the session user, because the CEO views
 * this dashboard too and their department_id is not Technical's.
 */
export async function getTechnicalDepartmentId(
  organizationId: string
): Promise<string | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', 'technical')
    .maybeSingle()

  return data?.id ?? null
}

/** Active members of the Technical department, for the lead's delegation controls. */
export async function getTechnicalEmployees(
  organizationId: string,
  departmentId: string | null
): Promise<{ id: string; full_name: string }[]> {
  if (!departmentId) return []

  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('organization_id', organizationId)
    .eq('department_id', departmentId)
    .eq('is_active', true)
    .order('full_name', { ascending: true })

  return (data ?? []) as { id: string; full_name: string }[]
}
