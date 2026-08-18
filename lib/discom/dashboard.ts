import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import {
  daysInCurrentStatus,
  isCaseStale,
  NET_METERING_TERMINAL_STATUSES,
  SUBSIDY_TERMINAL_STATUSES,
} from '@/lib/format'
import type {
  NetMeteringApplication,
  NetMeteringStatus,
  SubsidyCase,
  SubsidyStatus,
} from '@/lib/types'

/**
 * Read-side aggregations for the DISCOM dashboards.
 *
 * Every query runs on the session client, so RLS decides the rows: a liaison gets
 * the cases assigned to them, a lead or the CEO gets the department's, from the same
 * code. None of these takes a "which user" filter for that reason — narrowing to
 * "mine" is a display choice the page makes over the returned set, not a permission.
 *
 * THE AGING BLOCK IS THE POINT OF THIS MODULE. Each case is enriched at read time
 * with daysInStatus and isStale, both derived from the newest status-history row
 * (or created_at when the case has never moved). Nothing is stored: a persisted
 * day-count is wrong by the next morning, the same derived-never-stored rule the
 * rest of the app follows. The list pages sort longest-stuck-first off daysInStatus,
 * and the dashboard's "needs attention" count is isStale filtered over live cases.
 *
 * MONEY ARRIVES AS A STRING: numeric(14,2) comes back from supabase-js as a string
 * to avoid float drift. Any total goes through Number() before arithmetic.
 */

const ROW_CAP = 500

/** numeric → number. Null and unparseable both become 0. */
function money(raw: unknown): number {
  if (raw === null || raw === undefined) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

/** The newest created_at across a case's status-history rows, or null if none yet. */
function latestHistoryAt(history: Array<{ created_at: string }> | null | undefined): string | null {
  if (!history || history.length === 0) return null
  return history.reduce(
    (latest, row) => (latest === null || row.created_at > latest ? row.created_at : latest),
    null as string | null
  )
}

export interface DiscomEmployee {
  id: string
  full_name: string
  role_name: string
}

/** Active members of the DISCOM department, for assignee pickers and delegation. */
export async function getDiscomEmployees(organizationId: string): Promise<DiscomEmployee[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('users')
    .select('id, full_name, is_active, roles(name), departments!inner(slug)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .eq('departments.slug', DISCOM_DEPARTMENT_SLUG)
    .order('full_name')

  return (data ?? []).map((row) => {
    const role = row.roles as unknown as { name: string } | null
    return { id: row.id, full_name: row.full_name, role_name: role?.name ?? '' }
  })
}

/** The DISCOM department's id, needed to scope the CEO-assigned task queries. */
export async function getDiscomDepartmentId(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', DISCOM_DEPARTMENT_SLUG)
    .maybeSingle()

  return data?.id ?? null
}

/**
 * CEO tasks assigned to DISCOM without a named owner, for the lead's delegation
 * inbox. Mirrors getUnownedOMTasks. Empty when the department id is unknown rather
 * than returning every org task.
 */
export async function getUnownedDiscomTasks(
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
// Net metering
// ---------------------------------------------------------------------------

/** A net-metering application with the context and aging the list/board renders. */
export type NetMeteringWithAging = NetMeteringApplication & {
  customer: { name: string } | null
  assignee: { full_name: string } | null
  installation: { id: string; address: string | null } | null
  /** Newest status-history created_at, or null if the case has never moved. */
  lastStatusChangeAt: string | null
  /** Days the case has sat in its current status — derived, never stored. */
  daysInStatus: number
  /** True when a live case has been in its status past the staleness threshold. */
  isStale: boolean
}

export interface NetMeteringSummary {
  /** Every application RLS returned, sorted longest-stuck-first. */
  all: NetMeteringWithAging[]
  total: number
  /** Live (non-terminal) cases — the ones still being chased. */
  open: number
  approved: number
  rejected: number
  /** Live cases sitting past the staleness threshold — the "needs attention" count. */
  stale: number
  capped: boolean
}

const NM_SELECT =
  '*, customer:customers(name), assignee:users!net_metering_applications_assigned_to_fkey(full_name), installation:installations(id, address), history:net_metering_status_history(created_at)'

function enrichNetMetering(
  row: NetMeteringApplication & {
    customer: { name: string } | null
    assignee: { full_name: string } | null
    installation: { id: string; address: string | null } | null
    history?: Array<{ created_at: string }> | null
  }
): NetMeteringWithAging {
  const lastStatusChangeAt = latestHistoryAt(row.history)
  const isTerminal = NET_METERING_TERMINAL_STATUSES.includes(row.status)
  const daysInStatus = daysInCurrentStatus({ lastStatusChangeAt, createdAt: row.created_at })
  const isStale = isCaseStale({ isTerminal, lastStatusChangeAt, createdAt: row.created_at })
  return { ...row, lastStatusChangeAt, daysInStatus, isStale }
}

export async function getNetMeteringSummary(organizationId: string): Promise<NetMeteringSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('net_metering_applications')
    .select(NM_SELECT)
    .eq('organization_id', organizationId)
    .limit(ROW_CAP)

  const rows = ((data ?? []) as unknown as Parameters<typeof enrichNetMetering>[0][])
    .map(enrichNetMetering)
    // Longest-stuck-first: the case aging most is the one to look at.
    .sort((a, b) => b.daysInStatus - a.daysInStatus)

  const isTerminal = (s: NetMeteringStatus) => NET_METERING_TERMINAL_STATUSES.includes(s)

  return {
    all: rows,
    total: rows.length,
    open: rows.filter((r) => !isTerminal(r.status)).length,
    approved: rows.filter((r) => r.status === 'approved').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    stale: rows.filter((r) => r.isStale).length,
    capped: rows.length === ROW_CAP,
  }
}

/** One application with its full status history, for the detail page's timeline. */
export type NetMeteringDetail = NetMeteringWithAging & {
  history: Array<{
    id: string
    status: NetMeteringStatus
    note: string | null
    created_at: string
    author: { full_name: string } | null
  }>
  documents: Array<{
    id: string
    document_type: string
    file_name: string
    created_at: string
  }>
}

export async function getNetMeteringDetail(applicationId: string): Promise<NetMeteringDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('net_metering_applications')
    .select(
      `*,
       customer:customers(name),
       assignee:users!net_metering_applications_assigned_to_fkey(full_name),
       installation:installations(id, address),
       history:net_metering_status_history(id, status, note, created_at, author:users!net_metering_status_history_updated_by_fkey(full_name)),
       documents:government_documents(id, document_type, file_name, created_at)`
    )
    .eq('id', applicationId)
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as NetMeteringDetail & { history: Array<{ created_at: string }> }
  const enriched = enrichNetMetering(row)
  // Newest history first for the timeline; enrichment already read the max off it.
  const history = [...row.history].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return { ...enriched, history, documents: (data as unknown as NetMeteringDetail).documents } as NetMeteringDetail
}

// ---------------------------------------------------------------------------
// Subsidy
// ---------------------------------------------------------------------------

export type SubsidyWithAging = SubsidyCase & {
  customer: { name: string } | null
  assignee: { full_name: string } | null
  installation: { id: string; address: string | null } | null
  lastStatusChangeAt: string | null
  daysInStatus: number
  isStale: boolean
}

export interface SubsidySummary {
  all: SubsidyWithAging[]
  total: number
  open: number
  sanctioned: number
  disbursed: number
  rejected: number
  stale: number
  /** Total subsidy actually disbursed, for the department tile. */
  disbursedValue: number
  capped: boolean
}

const SUBSIDY_SELECT =
  '*, customer:customers(name), assignee:users!subsidy_cases_assigned_to_fkey(full_name), installation:installations(id, address), history:subsidy_status_history(created_at)'

function enrichSubsidy(
  row: SubsidyCase & {
    customer: { name: string } | null
    assignee: { full_name: string } | null
    installation: { id: string; address: string | null } | null
    history?: Array<{ created_at: string }> | null
  }
): SubsidyWithAging {
  const lastStatusChangeAt = latestHistoryAt(row.history)
  const isTerminal = SUBSIDY_TERMINAL_STATUSES.includes(row.status)
  const daysInStatus = daysInCurrentStatus({ lastStatusChangeAt, createdAt: row.created_at })
  const isStale = isCaseStale({ isTerminal, lastStatusChangeAt, createdAt: row.created_at })
  return { ...row, lastStatusChangeAt, daysInStatus, isStale }
}

export async function getSubsidySummary(organizationId: string): Promise<SubsidySummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('subsidy_cases')
    .select(SUBSIDY_SELECT)
    .eq('organization_id', organizationId)
    .limit(ROW_CAP)

  const rows = ((data ?? []) as unknown as Parameters<typeof enrichSubsidy>[0][])
    .map(enrichSubsidy)
    .sort((a, b) => b.daysInStatus - a.daysInStatus)

  const isTerminal = (s: SubsidyStatus) => SUBSIDY_TERMINAL_STATUSES.includes(s)

  return {
    all: rows,
    total: rows.length,
    open: rows.filter((r) => !isTerminal(r.status)).length,
    sanctioned: rows.filter((r) => r.status === 'sanctioned').length,
    disbursed: rows.filter((r) => r.status === 'disbursed').length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    stale: rows.filter((r) => r.isStale).length,
    disbursedValue: rows.reduce((sum, r) => sum + money(r.disbursed_amount), 0),
    capped: rows.length === ROW_CAP,
  }
}

export type SubsidyDetail = SubsidyWithAging & {
  history: Array<{
    id: string
    status: SubsidyStatus
    note: string | null
    created_at: string
    author: { full_name: string } | null
  }>
  documents: Array<{
    id: string
    document_type: string
    file_name: string
    created_at: string
  }>
}

export async function getSubsidyDetail(caseId: string): Promise<SubsidyDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('subsidy_cases')
    .select(
      `*,
       customer:customers(name),
       assignee:users!subsidy_cases_assigned_to_fkey(full_name),
       installation:installations(id, address),
       history:subsidy_status_history(id, status, note, created_at, author:users!subsidy_status_history_updated_by_fkey(full_name)),
       documents:government_documents(id, document_type, file_name, created_at)`
    )
    .eq('id', caseId)
    .maybeSingle()

  if (!data) return null

  const row = data as unknown as SubsidyDetail & { history: Array<{ created_at: string }> }
  const enriched = enrichSubsidy(row)
  const history = [...row.history].sort((a, b) => b.created_at.localeCompare(a.created_at))
  return { ...enriched, history, documents: (data as unknown as SubsidyDetail).documents } as SubsidyDetail
}

// ---------------------------------------------------------------------------
// Government documents
// ---------------------------------------------------------------------------

export type GovernmentDocumentRow = {
  id: string
  document_type: string
  file_name: string
  created_at: string
  net_metering_application_id: string | null
  subsidy_case_id: string | null
  installation_id: string | null
  uploader: { full_name: string } | null
}

/**
 * Documents the caller can see, newest first. RLS scopes them: a liaison sees the
 * documents on cases assigned to them (plus any org-scoped ones a lead filed), a
 * lead/CEO sees the department's. Optional filters narrow to one parent case, for the
 * "manage documents for this application" deep link.
 */
export async function getDocuments(
  organizationId: string,
  filter?: { netMeteringApplicationId?: string; subsidyCaseId?: string }
): Promise<GovernmentDocumentRow[]> {
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('government_documents')
    .select(
      'id, document_type, file_name, created_at, net_metering_application_id, subsidy_case_id, installation_id, uploader:users!government_documents_uploaded_by_fkey(full_name)'
    )
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(ROW_CAP)

  if (filter?.netMeteringApplicationId) {
    query = query.eq('net_metering_application_id', filter.netMeteringApplicationId)
  }
  if (filter?.subsidyCaseId) {
    query = query.eq('subsidy_case_id', filter.subsidyCaseId)
  }

  const { data } = await query
  return (data ?? []) as unknown as GovernmentDocumentRow[]
}

// ---------------------------------------------------------------------------
// Consumer verifications
// ---------------------------------------------------------------------------

export type ConsumerVerificationRow = {
  id: string
  consumer_number_verified: boolean
  identity_verified: boolean
  address_verified: boolean
  notes: string | null
  verified_at: string
  customer: { name: string } | null
  installation: { address: string | null } | null
  verifier: { full_name: string } | null
}

/**
 * Recent consumer-verification checks the caller can see, newest first. RLS scopes
 * them to the checks a liaison made (own = verified_by) or, for a lead/CEO, the
 * department's.
 */
export async function getConsumerVerifications(limit = 100): Promise<ConsumerVerificationRow[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('consumer_verifications')
    .select(
      'id, consumer_number_verified, identity_verified, address_verified, notes, verified_at, customer:customers(name), installation:installations(address), verifier:users!consumer_verifications_verified_by_fkey(full_name)'
    )
    .order('verified_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as ConsumerVerificationRow[]
}

// ---------------------------------------------------------------------------
// Pending handoffs — the O&M → DISCOM queue
// ---------------------------------------------------------------------------

export type PendingHandoff = {
  id: string
  address: string | null
  completed_date: string | null
  system_size_kw: number | null
  customer: { name: string } | null
  /** Days since the installation completed — how long the paperwork has waited. */
  daysWaiting: number
}

/**
 * Completed installations that have no net-metering application yet — the "O&M
 * finished, net metering paperwork not started" queue, and the front of the module's
 * value: work that has arrived but not been picked up.
 *
 * A note on RLS: discom_read_installations shows every completed install org-wide to
 * any DISCOM member, but the nested net_metering_applications only shows rows the
 * caller owns. So a liaison could see an install here that a colleague has already
 * started. That is acceptable — the handoff queue is a lead/CEO surface (they see all
 * applications, so their view is exact), and a liaison seeing one extra candidate is
 * a prompt to check, not a data leak. The dashboard shows this on the team tab.
 */
export async function getPendingHandoffs(organizationId: string): Promise<PendingHandoff[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('installations')
    .select(
      'id, address, completed_date, system_size_kw, customer:customers(name), net_metering_applications(id)'
    )
    .eq('organization_id', organizationId)
    .eq('status', 'completed')
    .order('completed_date', { ascending: true, nullsFirst: false })
    .limit(ROW_CAP)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    address: string | null
    completed_date: string | null
    system_size_kw: number | null
    customer: { name: string } | null
    net_metering_applications: Array<{ id: string }>
  }>

  const now = Date.now()
  return rows
    .filter((r) => r.net_metering_applications.length === 0)
    .map((r) => ({
      id: r.id,
      address: r.address,
      completed_date: r.completed_date,
      system_size_kw: r.system_size_kw,
      customer: r.customer,
      daysWaiting: r.completed_date
        ? Math.floor((now - new Date(r.completed_date).getTime()) / 86_400_000)
        : 0,
    }))
    // Longest-waiting first, the same longest-stuck-first the case lists use.
    .sort((a, b) => b.daysWaiting - a.daysWaiting)
}
