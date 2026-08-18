import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { CONTENT_SETTLED_STATUSES } from '@/lib/format'
import type {
  ContentCalendarItem,
  Campaign,
  ContentAsset,
  AiMarketingInsight,
} from '@/lib/types'

/**
 * Read-side aggregations for the Marketing & Training dashboards.
 *
 * Every query runs on the session client, so RLS decides the rows: an employee gets
 * what is assigned to them (content, campaigns), a lead or the CEO gets the whole
 * department's, from the same code. None of these takes a "which user" filter for
 * that reason — narrowing to "mine" is a display choice the page makes over the
 * returned set, not a permission.
 *
 * MONEY ARRIVES AS A STRING: numeric(14,2) comes back from supabase-js as a string
 * to avoid float drift. budget_amount and amount_spent go through Number() before any
 * arithmetic (the cost-per-lead column, spend-vs-budget bars).
 */

const ROW_CAP = 500

/** numeric → number. Null and unparseable both become 0. */
function money(raw: unknown): number {
  if (raw === null || raw === undefined) return 0
  const value = Number(raw)
  return Number.isFinite(value) ? value : 0
}

export interface MarketingEmployee {
  id: string
  full_name: string
  role_name: string
}

/** Active members of the Marketing department, for assignee/manager pickers and delegation. */
export async function getMarketingEmployees(organizationId: string): Promise<MarketingEmployee[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('users')
    .select('id, full_name, is_active, roles(name), departments!inner(slug)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .eq('departments.slug', MARKETING_DEPARTMENT_SLUG)
    .order('full_name')

  return (data ?? []).map((row) => {
    const role = row.roles as unknown as { name: string } | null
    return { id: row.id, full_name: row.full_name, role_name: role?.name ?? '' }
  })
}

/** The Marketing department's id, needed to scope the CEO-assigned task queries. */
export async function getMarketingDepartmentId(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', MARKETING_DEPARTMENT_SLUG)
    .maybeSingle()

  return data?.id ?? null
}

/**
 * CEO tasks assigned to Marketing without a named owner, for the lead's delegation
 * inbox. Mirrors getUnownedDiscomTasks. Empty when the department id is unknown
 * rather than returning every org task.
 */
export async function getUnownedMarketingTasks(
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
// Content calendar
// ---------------------------------------------------------------------------

/** A calendar item with the assignee context the grid and list render. */
export type ContentItemRow = ContentCalendarItem & {
  assignee: { full_name: string } | null
  /**
   * True when the item is due (scheduled today or earlier) and not yet settled
   * (posted/skipped) — the daily-reminder flag of §3.1, derived at read time, never
   * stored. The dashboard counts these; the calendar tints them.
   */
  needsAttention: boolean
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}

function enrichContentItem(
  row: ContentCalendarItem & { assignee: { full_name: string } | null }
): ContentItemRow {
  const settled = CONTENT_SETTLED_STATUSES.includes(row.status)
  const needsAttention = !settled && row.scheduled_date <= todayISO()
  return { ...row, needsAttention }
}

const CONTENT_SELECT =
  '*, assignee:users!content_calendar_items_assigned_to_fkey(full_name)'

/**
 * Every content item RLS returns, newest scheduled first. The calendar and list
 * pages render off this; "mine" is filtered in the page by assigned_to.
 */
export async function getContentItems(organizationId: string): Promise<ContentItemRow[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('content_calendar_items')
    .select(CONTENT_SELECT)
    .eq('organization_id', organizationId)
    .order('scheduled_date', { ascending: false })
    .limit(ROW_CAP)

  return ((data ?? []) as unknown as Parameters<typeof enrichContentItem>[0][]).map(
    enrichContentItem
  )
}

export type ContentItemDetail = ContentItemRow & {
  creator: { full_name: string } | null
  assets: Array<ContentAsset & { uploader: { full_name: string } | null }>
}

export async function getContentItemDetail(itemId: string): Promise<ContentItemDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('content_calendar_items')
    .select(
      `*,
       assignee:users!content_calendar_items_assigned_to_fkey(full_name),
       creator:users!content_calendar_items_created_by_fkey(full_name),
       assets:content_assets(*, uploader:users!content_assets_uploaded_by_fkey(full_name))`
    )
    .eq('id', itemId)
    .maybeSingle()

  if (!data) return null

  const enriched = enrichContentItem(
    data as unknown as ContentCalendarItem & { assignee: { full_name: string } | null }
  )
  const detail = data as unknown as ContentItemDetail
  return { ...enriched, creator: detail.creator, assets: detail.assets ?? [] }
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

/** A campaign with money coerced to numbers, so the UI can compute cost-per-lead directly. */
export type CampaignRow = Campaign & {
  manager: { full_name: string } | null
}

const CAMPAIGN_SELECT = '*, manager:users!campaigns_managed_by_fkey(full_name)'

function coerceCampaign(row: CampaignRow): CampaignRow {
  return {
    ...row,
    budget_amount: row.budget_amount === null ? null : money(row.budget_amount),
    amount_spent: money(row.amount_spent),
    leads_generated: Number(row.leads_generated) || 0,
  }
}

export async function getCampaigns(organizationId: string): Promise<CampaignRow[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('campaigns')
    .select(CAMPAIGN_SELECT)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(ROW_CAP)

  return ((data ?? []) as unknown as CampaignRow[]).map(coerceCampaign)
}

/**
 * One campaign with its linked lead_sources — the cross-module trace of which leads
 * it produced. Each source row references a Sales lead by id; Marketing has no read
 * access to the lead itself (by design), so only the id and the local source detail
 * show, which is exactly the read-only reference §3.3 asks for.
 */
export type CampaignDetail = CampaignRow & {
  lead_sources: Array<{
    id: string
    source_detail: string | null
    lead_id: string
    created_at: string
    content_calendar_item_id: string | null
    creator: { full_name: string } | null
  }>
}

export async function getCampaignDetail(campaignId: string): Promise<CampaignDetail | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('campaigns')
    .select(
      `*,
       manager:users!campaigns_managed_by_fkey(full_name),
       lead_sources(id, source_detail, lead_id, created_at, content_calendar_item_id, creator:users!lead_sources_created_by_fkey(full_name))`
    )
    .eq('id', campaignId)
    .maybeSingle()

  if (!data) return null

  const coerced = coerceCampaign(data as unknown as CampaignRow)
  const detail = data as unknown as CampaignDetail
  return {
    ...coerced,
    lead_sources: (detail.lead_sources ?? []).sort((a, b) =>
      b.created_at.localeCompare(a.created_at)
    ),
  }
}

// ---------------------------------------------------------------------------
// AI marketing insights
// ---------------------------------------------------------------------------

export type InsightRow = AiMarketingInsight & {
  acknowledger: { full_name: string } | null
}

/**
 * Recent insights, newest first. Pass onlyUnacknowledged for the dashboard's compact
 * feed (§3.1). If the CEO module's AI system has not run yet, this simply returns [],
 * and the page shows an empty state rather than erroring — the table exists from 0014
 * even when nothing has written to it.
 */
export async function getInsights(
  organizationId: string,
  opts?: { onlyUnacknowledged?: boolean; limit?: number }
): Promise<InsightRow[]> {
  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('ai_marketing_insights')
    .select('*, acknowledger:users!ai_marketing_insights_acknowledged_by_fkey(full_name)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? ROW_CAP)

  if (opts?.onlyUnacknowledged) query = query.is('acknowledged_by', null)

  const { data } = await query
  return (data ?? []) as unknown as InsightRow[]
}
