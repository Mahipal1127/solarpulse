import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isDepartmentManager } from '@/lib/auth/guards'
import { MARKETING_ASSETS_BUCKET, SIGNED_URL_TTL_SECONDS } from '@/lib/marketing/constants'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateContentItemInput,
  UpdateContentItemInput,
  CreateContentAssetInput,
  CreateCampaignInput,
  UpdateCampaignInput,
  CreateMarketingLeadInput,
} from '@/lib/validation/schemas'
import type {
  ContentCalendarItem,
  ContentAsset,
  Campaign,
} from '@/lib/types'

export { ServiceError }

/** Re-exported so a route can tell the caller how long its signed URL lasts. */
export { SIGNED_URL_TTL_SECONDS }

/**
 * The slug migration 0002 seeds this department under (hyphen, not underscore — the
 * build spec's 'marketing_training' is wrong), and the one every RLS helper in 0014
 * and every requireDepartment guard keys off.
 */
export const MARKETING_DEPARTMENT_SLUG = 'marketing-training'

/**
 * The department-wide tier, matching auth_is_marketing_lead() in migration 0014.
 * Both names accepted for the reason spelled out there: the build spec called this
 * "Marketing Lead", but the '<Department> Manager' convention that
 * auth_is_department_manager() (0006) and isDepartmentManager() (guards.ts) key off
 * requires the seeded role to end in "Manager". The seeded, working role is
 * 'Marketing Manager'.
 */
export const MARKETING_LEAD_ROLE_NAMES = ['Marketing Manager', 'Marketing Lead']

export function isMarketingLead(user: SessionUser): boolean {
  return (
    user.departmentSlug === MARKETING_DEPARTMENT_SLUG &&
    (isDepartmentManager(user) || MARKETING_LEAD_ROLE_NAMES.includes(user.roleName))
  )
}

/**
 * Marketing records are written by the department only; the CEO reads this module but
 * does not write to it, the same rule every prior module enforces.
 */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== MARKETING_DEPARTMENT_SLUG) {
    throw new ServiceError('Marketing records are read-only outside the department', 403)
  }
}

/**
 * The assignee must be an active member of Marketing. RLS scopes rows to the org but
 * cannot cheaply express "belongs to the department that owns this table", so the
 * check lives here — and turns an opaque RLS rejection into a clear 400. Used for
 * content assignees and campaign managers, who must be Marketing people.
 */
async function assertMarketingEmployee(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  user: SessionUser,
  employeeId: string
): Promise<void> {
  const { data } = await supabase
    .from('users')
    .select('id, is_active, departments(slug)')
    .eq('id', employeeId)
    .eq('organization_id', user.organization_id)
    .maybeSingle()

  if (!data) throw new ServiceError('Employee not found in this organization', 400)
  if (!data.is_active) throw new ServiceError('Employee is not active', 400)

  const department = data.departments as unknown as { slug: string } | null
  if (department?.slug !== MARKETING_DEPARTMENT_SLUG) {
    throw new ServiceError('Employee is not a member of the Marketing & Training department', 400)
  }
}

/**
 * Loads a record the caller can see, letting RLS decide. A row outside the caller's
 * reach is not returned, surfacing as the same 404 as a row that does not exist — not
 * leaking the difference is intentional.
 */
async function loadVisible<T>(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  table: string,
  id: string,
  columns: string,
  label: string
): Promise<T> {
  const { data } = await supabase.from(table).select(columns).eq('id', id).maybeSingle()
  if (!data) throw new ServiceError(`${label} not found`, 404)
  return data as T
}

// ---------------------------------------------------------------------------
// Content calendar
// ---------------------------------------------------------------------------

export async function createContentItem(
  user: SessionUser,
  input: CreateContentItemInput
): Promise<ContentCalendarItem> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await assertMarketingEmployee(supabase, user, input.assigned_to)

  const { data, error } = await supabase
    .from('content_calendar_items')
    .insert({
      organization_id: user.organization_id,
      title: input.title,
      content_type: input.content_type,
      platform: input.platform,
      scheduled_date: input.scheduled_date,
      assigned_to: input.assigned_to,
      caption_draft: input.caption_draft ?? null,
      notes: input.notes ?? null,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'content_item_created',
    entityType: 'content_calendar_item',
    entityId: data.id,
    metadata: { content_type: input.content_type, assigned_to: input.assigned_to },
  })

  return data as ContentCalendarItem
}

export async function updateContentItem(
  user: SessionUser,
  itemId: string,
  input: UpdateContentItemInput
): Promise<ContentCalendarItem> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const existing = await loadVisible<Pick<ContentCalendarItem, 'id' | 'assigned_to'>>(
    supabase,
    'content_calendar_items',
    itemId,
    'id, assigned_to',
    'Content item'
  )

  if (input.assigned_to && input.assigned_to !== existing.assigned_to) {
    await assertMarketingEmployee(supabase, user, input.assigned_to)
  }

  const { data, error } = await supabase
    .from('content_calendar_items')
    .update(input)
    .eq('id', itemId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  const reassigned = Boolean(input.assigned_to) && input.assigned_to !== existing.assigned_to

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: reassigned ? 'content_item_reassigned' : 'content_item_updated',
    entityType: 'content_calendar_item',
    entityId: itemId,
    metadata: {
      changed: Object.keys(input),
      ...(reassigned ? { from_assignee: existing.assigned_to, to_assignee: input.assigned_to } : {}),
    },
  })

  return data as ContentCalendarItem
}

// ---------------------------------------------------------------------------
// Content assets
// ---------------------------------------------------------------------------

/**
 * Records an already-uploaded asset against a content item. The storage path is
 * '{content_calendar_item_id}/{filename}' (the O&M shape — the item id is the first
 * segment, not the org), so the org-folder check the document modules use does not
 * translate; instead we confirm the named item is visible to the caller (RLS) and the
 * path's first segment is that item. RLS on content_assets then enforces ownership.
 */
export async function addContentAsset(
  user: SessionUser,
  input: CreateContentAssetInput
): Promise<ContentAsset> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // The item must be visible to the caller — a member can only attach to their own.
  await loadVisible<Pick<ContentCalendarItem, 'id'>>(
    supabase,
    'content_calendar_items',
    input.content_calendar_item_id,
    'id',
    'Content item'
  )

  // The uploaded object must live under this item's folder, matching the storage
  // policy that gates on the first path segment.
  if (!input.file_path.startsWith(`${input.content_calendar_item_id}/`)) {
    throw new ServiceError('File path does not belong to this content item', 400)
  }

  const { data, error } = await supabase
    .from('content_assets')
    .insert({
      content_calendar_item_id: input.content_calendar_item_id,
      file_path: input.file_path,
      file_name: input.file_name,
      asset_type: input.asset_type ?? null,
      uploaded_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'content_asset_uploaded',
    entityType: 'content_asset',
    entityId: data.id,
    metadata: {
      content_calendar_item_id: input.content_calendar_item_id,
      file_name: input.file_name,
      asset_type: input.asset_type ?? null,
    },
  })

  return data as ContentAsset
}

/**
 * Mints a short-lived signed URL for one asset. These are ordinary marketing files
 * (footage, graphics), not personal documents, so the download is logged with
 * logAction rather than logSensitiveAccess. The asset is loaded under RLS first, so
 * one the caller cannot see is a 404 and no URL is minted.
 */
export async function signAssetDownload(
  user: SessionUser,
  assetId: string
): Promise<{ url: string; fileName: string }> {
  const supabase = await createSupabaseServerClient()

  const asset = await loadVisible<Pick<ContentAsset, 'id' | 'file_path' | 'file_name'>>(
    supabase,
    'content_assets',
    assetId,
    'id, file_path, file_name',
    'Asset'
  )

  const { data, error } = await supabase.storage
    .from(MARKETING_ASSETS_BUCKET)
    .createSignedUrl(asset.file_path, SIGNED_URL_TTL_SECONDS, { download: asset.file_name })

  if (error || !data) throw new ServiceError(error?.message ?? 'Could not sign the file', 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'content_asset_downloaded',
    entityType: 'content_asset',
    entityId: asset.id,
    metadata: { file_name: asset.file_name },
  })

  return { url: data.signedUrl, fileName: asset.file_name }
}

export async function deleteContentAsset(user: SessionUser, assetId: string): Promise<void> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const asset = await loadVisible<Pick<ContentAsset, 'id' | 'file_name'>>(
    supabase,
    'content_assets',
    assetId,
    'id, file_name',
    'Asset'
  )

  const { error } = await supabase.from('content_assets').delete().eq('id', assetId)
  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'content_asset_deleted',
    entityType: 'content_asset',
    entityId: assetId,
    metadata: { file_name: asset.file_name },
  })
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

export async function createCampaign(
  user: SessionUser,
  input: CreateCampaignInput
): Promise<Campaign> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  await assertMarketingEmployee(supabase, user, input.managed_by)

  const { data, error } = await supabase
    .from('campaigns')
    .insert({
      organization_id: user.organization_id,
      name: input.name,
      objective: input.objective ?? null,
      platform: input.platform ?? null,
      start_date: input.start_date ?? null,
      end_date: input.end_date ?? null,
      budget_amount: input.budget_amount ?? null,
      managed_by: input.managed_by,
      created_by: user.id,
    })
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'campaign_created',
    entityType: 'campaign',
    entityId: data.id,
    metadata: { name: input.name, managed_by: input.managed_by },
  })

  return data as Campaign
}

/**
 * Updates a campaign — status, dates, budget, and the periodically-logged
 * amount_spent (no live ad-platform sync, per scope). leads_generated is NOT settable
 * here: it is a counter the lead handoff owns, so it moves only through
 * create_marketing_lead. The update schema omits it and this rejects it if smuggled.
 */
export async function updateCampaign(
  user: SessionUser,
  campaignId: string,
  input: UpdateCampaignInput
): Promise<Campaign> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  if ('leads_generated' in (input as Record<string, unknown>)) {
    throw new ServiceError('The leads counter is maintained by the lead handoff, not editable', 400)
  }

  const existing = await loadVisible<Pick<Campaign, 'id' | 'managed_by'>>(
    supabase,
    'campaigns',
    campaignId,
    'id, managed_by',
    'Campaign'
  )

  if (input.managed_by && input.managed_by !== existing.managed_by) {
    await assertMarketingEmployee(supabase, user, input.managed_by)
  }

  const { data, error } = await supabase
    .from('campaigns')
    .update(input)
    .eq('id', campaignId)
    .select()
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'campaign_updated',
    entityType: 'campaign',
    entityId: campaignId,
    metadata: { changed: Object.keys(input) },
  })

  return data as Campaign
}

// ---------------------------------------------------------------------------
// Lead generation → Sales handoff (the module's central integration)
// ---------------------------------------------------------------------------

/**
 * Originates a Sales lead from Marketing — the §3.4 handoff, and the reason this
 * module sits ahead of Sales in the pipeline. Delegates to the create_marketing_lead
 * RPC (migration 0014) so the three writes are one transaction: the unassigned
 * inbound Sales lead, the lead_sources trace row, and the campaign counter bump. The
 * RPC runs as the caller (NOT security definer), so RLS still governs every write —
 * Marketing's narrow insert-only grant on leads, and the lead_sources member policy.
 *
 * Returns the new lead's id. Marketing has no SELECT on leads (by design — it can
 * create an inbound lead but never read or steer Sales' pipeline), so there is no
 * lead row to hand back, only the id the RPC generated.
 */
export async function createMarketingLead(
  user: SessionUser,
  input: CreateMarketingLeadInput
): Promise<{ leadId: string }> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase.rpc('create_marketing_lead', {
    p_name: input.name,
    p_phone: input.phone ?? null,
    p_source_detail: input.source_detail ?? null,
    p_campaign_id: input.campaign_id ?? null,
    p_content_calendar_item_id: input.content_calendar_item_id ?? null,
    p_notes: input.notes ?? null,
  })

  // The function's raise messages ("Campaign not found or not visible", etc.) are
  // written to be caller-facing.
  if (error) throw new ServiceError(error.message, 400)

  const leadId = data as unknown as string

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_lead_created',
    entityType: 'lead',
    entityId: leadId,
    metadata: {
      campaign_id: input.campaign_id ?? null,
      content_calendar_item_id: input.content_calendar_item_id ?? null,
      source_detail: input.source_detail ?? null,
    },
  })

  return { leadId }
}

// ---------------------------------------------------------------------------
// AI marketing insights
// ---------------------------------------------------------------------------

/**
 * Acknowledges an insight — the only write the team may make to ai_marketing_insights
 * (there is no insert path; the CEO module's AI system populates the table through
 * the service-role client). Stamps acknowledged_by/at. Loaded under RLS first.
 */
export async function acknowledgeInsight(user: SessionUser, insightId: string): Promise<void> {
  // No assertCanWrite: the CEO also reads this module and may acknowledge, and the
  // RLS update policy already admits both Marketing members and the CEO.
  const supabase = await createSupabaseServerClient()

  await loadVisible<{ id: string }>(
    supabase,
    'ai_marketing_insights',
    insightId,
    'id',
    'Insight'
  )

  const { error } = await supabase
    .from('ai_marketing_insights')
    .update({ acknowledged_by: user.id, acknowledged_at: new Date().toISOString() })
    .eq('id', insightId)

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'ai_insight_acknowledged',
    entityType: 'ai_marketing_insight',
    entityId: insightId,
  })
}
