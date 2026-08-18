import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { INSTALLATION_OPEN_STATUSES, isAmcExpiringSoon, isAmcExpired } from '@/lib/format'
import type {
  Installation,
  InstallationStatus,
  ServiceTicket,
  AmcContract,
  AmcVisit,
} from '@/lib/types'

/**
 * Read-side aggregations for the Operations & Maintenance dashboards.
 *
 * Every query runs on the session client, so RLS decides the rows: a technician
 * gets the installations they are on, a lead or the CEO gets the department's, from
 * the same code. None of these takes a "which user" filter for that reason —
 * narrowing to "mine" is a display choice the page makes over the returned set, not
 * a permission, and moving it in here would mask a policy regression instead of
 * surfacing it.
 *
 * MONEY ARRIVES AS A STRING: amc_contracts.amount is numeric(14,2), which
 * supabase-js returns as a string to avoid float drift. Any total goes through
 * Number() before arithmetic — `0 + "5000"` is `"05000"` — the same care every
 * other module's dashboard takes.
 *
 * TWO STATES ARE COMPUTED, NOT STORED: an AMC's expiring_soon/expired and a visit's
 * missed come from a date at read time (isAmcExpiringSoon/isAmcExpired in format.ts),
 * never from a column. The counts below derive them so the dashboard and the list
 * badge cannot disagree.
 */

const ROW_CAP = 500

/** numeric → number. Null and unparseable both become 0. */
function money(raw: unknown): number {
  if (raw === null || raw === undefined) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

export interface OMEmployee {
  id: string
  full_name: string
  role_name: string
}

/** Active members of the O&M department, for assignee and team pickers. */
export async function getOMEmployees(organizationId: string): Promise<OMEmployee[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('users')
    .select('id, full_name, is_active, roles(name), departments!inner(slug)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .eq('departments.slug', OM_DEPARTMENT_SLUG)
    .order('full_name')

  return (data ?? []).map((row) => {
    const role = row.roles as unknown as { name: string } | null
    return { id: row.id, full_name: row.full_name, role_name: role?.name ?? '' }
  })
}

/** The O&M department's id, needed to scope the CEO-assigned task queries. */
export async function getOMDepartmentId(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', OM_DEPARTMENT_SLUG)
    .maybeSingle()

  return data?.id ?? null
}

/**
 * CEO tasks assigned to O&M without a named owner, for the lead's delegation inbox.
 * Mirrors getUnownedDepartmentTasks in the Technical module. Empty when the
 * department id is unknown rather than returning every org task.
 */
export async function getUnownedOMTasks(
  organizationId: string,
  departmentId: string | null
): Promise<unknown[]> {
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

  return data ?? []
}

// ---------------------------------------------------------------------------
// Installations
// ---------------------------------------------------------------------------

export type InstallationWithContext = Installation & {
  customer: { name: string } | null
  team_lead: { full_name: string } | null
}

export interface InstallationSummary {
  /** Every installation RLS returned, for callers that group or filter rather than count. */
  all: InstallationWithContext[]
  total: number
  open: number
  inProgress: number
  onHold: number
  completed: number
  cancelled: number
  capped: boolean
}

const INSTALL_SELECT =
  '*, customer:customers(name), team_lead:users!installations_team_lead_id_fkey(full_name)'

export async function getInstallationSummary(
  organizationId: string
): Promise<InstallationSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('installations')
    .select(INSTALL_SELECT)
    .eq('organization_id', organizationId)
    .order('scheduled_start_date', { ascending: true, nullsFirst: false })
    .limit(ROW_CAP)

  const rows = (data ?? []) as unknown as InstallationWithContext[]
  const count = (s: InstallationStatus) => rows.filter((r) => r.status === s).length

  return {
    all: rows,
    total: rows.length,
    open: rows.filter((r) => INSTALLATION_OPEN_STATUSES.includes(r.status)).length,
    inProgress: count('in_progress'),
    onHold: count('on_hold'),
    completed: count('completed'),
    cancelled: count('cancelled'),
    capped: rows.length === ROW_CAP,
  }
}

/** One installation with everything the detail page renders around it. */
export type InstallationDetail = InstallationWithContext & {
  team: Array<{
    id: string
    user_id: string
    role_on_site: string | null
    member: { full_name: string } | null
  }>
  progress: Array<{
    id: string
    progress_percent: number
    note: string | null
    created_at: string
    author: { full_name: string } | null
  }>
  photos: Array<{
    id: string
    file_name: string
    photo_stage: string | null
    created_at: string
  }>
  checklist: Array<{
    id: string
    item: string
    is_checked: boolean
    checked_at: string | null
    checker: { full_name: string } | null
  }>
  inspections: Array<{
    id: string
    result: string
    notes: string | null
    inspected_at: string
    inspector: { full_name: string } | null
  }>
  completion: Array<{ id: string; summary: string; created_at: string }>
}

export async function getInstallationDetail(
  installationId: string
): Promise<InstallationDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('installations')
    .select(
      `*,
       customer:customers(name),
       team_lead:users!installations_team_lead_id_fkey(full_name),
       team:installation_team_members(id, user_id, role_on_site, member:users!installation_team_members_user_id_fkey(full_name)),
       progress:installation_progress_updates(id, progress_percent, note, created_at, author:users!installation_progress_updates_updated_by_fkey(full_name)),
       photos:installation_photos(id, file_name, photo_stage, created_at),
       checklist:installation_checklists(id, item, is_checked, checked_at, checker:users!installation_checklists_checked_by_fkey(full_name)),
       inspections:final_inspections(id, result, notes, inspected_at, inspector:users!final_inspections_inspected_by_fkey(full_name)),
       completion:completion_reports(id, summary, created_at)`
    )
    .eq('id', installationId)
    .maybeSingle()

  if (!data) return null
  return data as unknown as InstallationDetail
}

// ---------------------------------------------------------------------------
// Service tickets
// ---------------------------------------------------------------------------

export type ServiceTicketWithContext = ServiceTicket & {
  customer: { name: string } | null
  assignee: { full_name: string } | null
}

export interface ServiceSummary {
  all: ServiceTicketWithContext[]
  total: number
  open: number
  unassigned: number
  inProgress: number
  resolved: number
  /** Open tickets at high/urgent priority — the ones the queue should surface first. */
  urgent: number
  capped: boolean
}

const TICKET_SELECT =
  '*, customer:customers(name), assignee:users!service_tickets_assigned_to_fkey(full_name)'

export async function getServiceSummary(organizationId: string): Promise<ServiceSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('service_tickets')
    .select(TICKET_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(ROW_CAP)

  const rows = (data ?? []) as unknown as ServiceTicketWithContext[]
  const isOpen = (t: ServiceTicketWithContext) =>
    t.status === 'open' || t.status === 'assigned' || t.status === 'in_progress'

  return {
    all: rows,
    total: rows.length,
    open: rows.filter(isOpen).length,
    unassigned: rows.filter((t) => t.status === 'open' && t.assigned_to === null).length,
    inProgress: rows.filter((t) => t.status === 'in_progress').length,
    resolved: rows.filter((t) => t.status === 'resolved').length,
    urgent: rows.filter(
      (t) => isOpen(t) && (t.priority === 'urgent' || t.priority === 'high')
    ).length,
    capped: rows.length === ROW_CAP,
  }
}

/** One ticket with its logged service reports, for the detail page. */
export type ServiceTicketDetail = ServiceTicketWithContext & {
  installation: { id: string; address: string | null } | null
  reports: Array<{
    id: string
    work_done: string
    parts_used: string | null
    resolved: boolean
    created_at: string
    author: { full_name: string } | null
  }>
}

export async function getServiceTicketDetail(
  ticketId: string
): Promise<ServiceTicketDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('service_tickets')
    .select(
      `*,
       customer:customers(name),
       assignee:users!service_tickets_assigned_to_fkey(full_name),
       installation:installations(id, address),
       reports:service_reports(id, work_done, parts_used, resolved, created_at, author:users!service_reports_reported_by_fkey(full_name))`
    )
    .eq('id', ticketId)
    .maybeSingle()

  if (!data) return null
  return data as unknown as ServiceTicketDetail
}

// ---------------------------------------------------------------------------
// AMC
// ---------------------------------------------------------------------------

export type AmcContractWithContext = AmcContract & {
  customer: { name: string } | null
  assignee: { full_name: string } | null
}

export interface AmcSummary {
  all: AmcContractWithContext[]
  total: number
  active: number
  /** Active and within the renewal window — computed from end_date, not stored. */
  expiringSoon: number
  expired: number
  cancelled: number
  /** Contract value of the active book. */
  activeValue: number
  capped: boolean
}

const AMC_SELECT =
  '*, customer:customers(name), assignee:users!amc_contracts_assigned_to_fkey(full_name)'

export async function getAmcSummary(organizationId: string): Promise<AmcSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('amc_contracts')
    .select(AMC_SELECT)
    .eq('organization_id', organizationId)
    .order('end_date', { ascending: true })
    .limit(ROW_CAP)

  const rows = (data ?? []) as unknown as AmcContractWithContext[]
  const active = rows.filter((c) => c.status === 'active')

  return {
    all: rows,
    total: rows.length,
    active: active.length,
    expiringSoon: active.filter(isAmcExpiringSoon).length,
    expired: active.filter(isAmcExpired).length,
    cancelled: rows.filter((c) => c.status === 'cancelled').length,
    activeValue: active.reduce((sum, c) => sum + money(c.amount), 0),
    capped: rows.length === ROW_CAP,
  }
}

/** Upcoming visits across all contracts the caller can see, soonest first. */
export type UpcomingVisit = AmcVisit & {
  contract: { id: string; customer: { name: string } | null } | null
}

export async function getUpcomingVisits(withinDays = 14): Promise<UpcomingVisit[]> {
  const supabase = await createSupabaseServerClient()

  const horizon = new Date()
  horizon.setDate(horizon.getDate() + withinDays)
  const horizonDate = horizon.toISOString().slice(0, 10)

  const { data } = await supabase
    .from('amc_visits')
    .select('*, contract:amc_contracts(id, customer:customers(name))')
    .eq('status', 'scheduled')
    .lte('scheduled_date', horizonDate)
    .order('scheduled_date', { ascending: true })
    .limit(ROW_CAP)

  return (data ?? []) as unknown as UpcomingVisit[]
}

// ---------------------------------------------------------------------------
// Performance
// ---------------------------------------------------------------------------

export type FlaggedReading = {
  id: string
  installation_id: string
  log_date: string
  generation_kwh: number | null
  notes: string | null
  installation: { address: string | null; customer: { name: string } | null } | null
}

/**
 * Recent underperformance flags across visible installations, for the lead's
 * follow-up list. issue_flag = true is the surveyor saying "this reading looks
 * wrong" — §3.5 asks these surface on the team dashboard.
 */
export async function getFlaggedReadings(limit = 10): Promise<FlaggedReading[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('performance_logs')
    .select(
      'id, installation_id, log_date, generation_kwh, notes, installation:installations(address, customer:customers(name))'
    )
    .eq('issue_flag', true)
    .order('log_date', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as FlaggedReading[]
}
