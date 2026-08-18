import type {
  ContentType,
  ContentStatus,
  ContentAssetType,
  CampaignObjective,
  CampaignPlatform,
  CampaignStatus,
} from '@/lib/types'

/**
 * Marketing & Training domain vocabularies and storage constants.
 *
 * No 'server-only': these lists feed client pickers (the content form, campaign
 * form, attendance roster), so client components import from here. Nothing here is a
 * permission check — the service layer and RLS do that. Display labels and colours
 * live in lib/format.ts alongside every other module's.
 *
 * Type-only imports keep this file client-safe: `import type` is erased at build, so
 * pulling the status unions in adds no server dependency. The `as const satisfies`
 * pattern fixes a display order for each picker while proving every value is a member
 * of its DB-backed union — a typo here is a compile error, not a runtime surprise.
 */

export const CONTENT_TYPES = [
  'reel',
  'post',
  'story',
  'ad_creative',
] as const satisfies readonly ContentType[]

export const CONTENT_STATUSES = [
  'planned',
  'in_production',
  'ready',
  'posted',
  'skipped',
] as const satisfies readonly ContentStatus[]

export const CONTENT_ASSET_TYPES = [
  'raw_footage',
  'edited_video',
  'graphic',
  'script',
  'thumbnail',
] as const satisfies readonly ContentAssetType[]

export const CAMPAIGN_OBJECTIVES = [
  'lead_generation',
  'brand_awareness',
  'website_traffic',
] as const satisfies readonly CampaignObjective[]

export const CAMPAIGN_PLATFORMS = [
  'instagram',
  'facebook',
  'google',
  'other',
] as const satisfies readonly CampaignPlatform[]

export const CAMPAIGN_STATUSES = [
  'planning',
  'active',
  'paused',
  'completed',
] as const satisfies readonly CampaignStatus[]

/**
 * The source_detail hints offered by the lead-capture form. lead_sources.source_detail
 * is free text in the DB (0014) — this is a suggestion list, not a constraint.
 */
export const LEAD_SOURCE_DETAILS = [
  'organic_reel',
  'paid_ad',
  'referral',
  'website_form',
  'walk_in',
] as const

export const LEAD_SOURCE_DETAIL_LABELS: Record<string, string> = {
  organic_reel: 'Organic Reel',
  paid_ad: 'Paid Ad',
  referral: 'Referral',
  website_form: 'Website Form',
  walk_in: 'Walk-in',
}

export function formatLeadSourceDetail(detail: string | null | undefined): string {
  if (!detail) return '—'
  return LEAD_SOURCE_DETAIL_LABELS[detail] ?? detail
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * Private bucket created in migration 0014. Objects live at
 * '{content_calendar_item_id}/{filename}' — the item id is the FIRST path segment
 * (the O&M installation-media shape), so the storage policy gates through the owning
 * item, not the org. content_assets' RLS and the service layer enforce the rest.
 */
export const MARKETING_ASSETS_BUCKET = 'marketing-assets'

/** How long a download link stays valid. Short on purpose — a signed URL is a bearer token. */
export const SIGNED_URL_TTL_SECONDS = 300

/** Upload ceiling. Edited videos are the large case, so this is roomier than a docs bucket. */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024
