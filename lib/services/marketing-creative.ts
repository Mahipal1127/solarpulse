import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { generateScript, generatePlan } from '@/lib/ai/marketing-creative'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  BrandProfile,
  BrandContext,
  AuditSignals,
  ReferenceExample,
  ScriptLibraryEntry,
  ScriptSource,
  MarketingScript,
  ScriptFacts,
  ContentPlan,
  PlanFacts,
  PlanRangeKind,
  ScriptContentType,
} from '@/lib/marketing/creative-types'

export { ServiceError }

/**
 * The service behind Marketing → AI Insights → AI Creative, and the AI Calendar planner.
 *
 * FOUR JOBS.
 *   1. Assemble the grounding context — brand profile + distilled audit signals + reference
 *      scripts — that every generation is built on. This is where "mainly brand profile + IG
 *      audit" (the user's choice) actually happens.
 *   2. Run the generators and store the result WITH its facts, so a script or plan can always
 *      be checked against what it was written from.
 *   3. Close the refinement loop: approving a script copies it into the reference library as
 *      'ai_approved', so the next generation is shown it.
 *   4. Commit a proposed plan into real content_calendar_items — the one place this feature
 *      touches the live calendar, and only on the user's explicit commit.
 *
 * All reads and writes go through the RLS client. 0021 gives marketing members full write
 * policies on these tables and the CEO read-only, so the database enforces the same boundary
 * the guards do — no service-client bypass anywhere in this file.
 */

const WRITE_DENIED = 'Marketing creative records are read-only outside the department'

/** Every write in this module is a marketing-member action; the CEO reads only. */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== MARKETING_DEPARTMENT_SLUG) {
    throw new ServiceError(WRITE_DENIED, 403)
  }
}

/** Supabase to-one embeds arrive as an object or a one-element array; normalise the name. */
function embeddedName(
  value: { full_name: string | null } | { full_name: string | null }[] | null | undefined
): string | null {
  if (!value) return null
  const row = Array.isArray(value) ? value[0] : value
  return row?.full_name ?? null
}

// ===========================================================================
// Brand profile
// ===========================================================================

const BRAND_COLUMNS =
  'id, organization_id, business_name, what_we_sell, target_audience, tone_voice, key_offers, seo_keywords, extra_notes, updated_by, created_at, updated_at, updater:users!marketing_brand_profile_updated_by_fkey(full_name)'

interface BrandRow {
  id: string
  organization_id: string
  business_name: string | null
  what_we_sell: string | null
  target_audience: string | null
  tone_voice: string | null
  key_offers: string | null
  seo_keywords: string | null
  extra_notes: string | null
  updated_by: string | null
  created_at: string
  updated_at: string
  updater: { full_name: string | null } | { full_name: string | null }[] | null
}

function toBrandProfile(row: BrandRow): BrandProfile {
  return {
    id: row.id,
    organization_id: row.organization_id,
    business_name: row.business_name,
    what_we_sell: row.what_we_sell,
    target_audience: row.target_audience,
    tone_voice: row.tone_voice,
    key_offers: row.key_offers,
    seo_keywords: row.seo_keywords,
    extra_notes: row.extra_notes,
    updated_by: row.updated_by,
    updated_by_name: embeddedName(row.updater),
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getBrandProfile(): Promise<BrandProfile | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('marketing_brand_profile')
    .select(BRAND_COLUMNS)
    .maybeSingle()

  if (error) throw new ServiceError(error.message, 500)
  return data ? toBrandProfile(data as unknown as BrandRow) : null
}

export interface BrandProfileInput {
  business_name?: string | null
  what_we_sell?: string | null
  target_audience?: string | null
  tone_voice?: string | null
  key_offers?: string | null
  seo_keywords?: string | null
  extra_notes?: string | null
}

/**
 * Upsert the org's single brand profile.
 *
 * onConflict on organization_id (the unique index in 0021) makes this idempotent: the first
 * save inserts, every later save updates the same row. The RLS write policy authorises it, so
 * a non-member reaching here is refused by the database as well as by the guard.
 */
export async function upsertBrandProfile(
  user: SessionUser,
  input: BrandProfileInput
): Promise<BrandProfile> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('marketing_brand_profile')
    .upsert(
      {
        organization_id: user.organization_id,
        business_name: input.business_name ?? null,
        what_we_sell: input.what_we_sell ?? null,
        target_audience: input.target_audience ?? null,
        tone_voice: input.tone_voice ?? null,
        key_offers: input.key_offers ?? null,
        seo_keywords: input.seo_keywords ?? null,
        extra_notes: input.extra_notes ?? null,
        updated_by: user.id,
      },
      { onConflict: 'organization_id' }
    )
    .select(BRAND_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_brand_profile_saved',
    entityType: 'marketing_brand_profile',
    entityId: data.id,
  })

  return toBrandProfile(data as unknown as BrandRow)
}

// ===========================================================================
// Script library (the two upload lanes + approved AI)
// ===========================================================================

const LIBRARY_COLUMNS =
  'id, source, title, body, content_type, platform, attribution, notes, origin_script_id, added_by, created_at, adder:users!marketing_script_library_added_by_fkey(full_name)'

interface LibraryRow {
  id: string
  source: string
  title: string
  body: string
  content_type: string | null
  platform: string
  attribution: string | null
  notes: string | null
  origin_script_id: string | null
  added_by: string | null
  created_at: string
  adder: { full_name: string | null } | { full_name: string | null }[] | null
}

function toLibraryEntry(row: LibraryRow): ScriptLibraryEntry {
  return {
    id: row.id,
    source: row.source as ScriptSource,
    title: row.title,
    body: row.body,
    content_type: row.content_type,
    platform: row.platform,
    attribution: row.attribution,
    notes: row.notes,
    origin_script_id: row.origin_script_id,
    added_by: row.added_by,
    added_by_name: embeddedName(row.adder),
    created_at: row.created_at,
  }
}

export async function listLibrary(): Promise<ScriptLibraryEntry[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('marketing_script_library')
    .select(LIBRARY_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) throw new ServiceError(error.message, 500)
  return ((data ?? []) as unknown as LibraryRow[]).map(toLibraryEntry)
}

export interface AddLibraryInput {
  source: ScriptSource
  title: string
  body: string
  content_type?: string | null
  platform?: string
  attribution?: string | null
  notes?: string | null
}

export async function addLibraryEntry(
  user: SessionUser,
  input: AddLibraryInput
): Promise<ScriptLibraryEntry> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('marketing_script_library')
    .insert({
      organization_id: user.organization_id,
      source: input.source,
      title: input.title,
      body: input.body,
      content_type: input.content_type ?? null,
      platform: input.platform ?? 'instagram',
      attribution: input.attribution ?? null,
      notes: input.notes ?? null,
      added_by: user.id,
    })
    .select(LIBRARY_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_script_reference_added',
    entityType: 'marketing_script_library',
    entityId: data.id,
    metadata: { source: input.source },
  })

  return toLibraryEntry(data as unknown as LibraryRow)
}

export async function deleteLibraryEntry(user: SessionUser, entryId: string): Promise<void> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase.from('marketing_script_library').delete().eq('id', entryId)
  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_script_reference_deleted',
    entityType: 'marketing_script_library',
    entityId: entryId,
  })
}

// ===========================================================================
// Context assembly — brand + audit signals + references
// ===========================================================================

/** Blank the profile down to non-empty fields; return null if nothing was filled in. */
function toBrandContext(profile: BrandProfile | null): BrandContext | null {
  if (!profile) return null
  const context: BrandContext = {
    business_name: profile.business_name,
    what_we_sell: profile.what_we_sell,
    target_audience: profile.target_audience,
    tone_voice: profile.tone_voice,
    key_offers: profile.key_offers,
    seo_keywords: profile.seo_keywords,
    extra_notes: profile.extra_notes,
  }
  const hasAny = Object.values(context).some((value) => value && value.trim().length > 0)
  return hasAny ? context : null
}

/**
 * Distil the org's latest Instagram audit into the handful of signals a writer uses.
 *
 * Reads the newest instagram_audits row for the org through RLS, then pulls just the working
 * signals out of its stored facts — never the whole blob. Returns null when no audit exists, so
 * the prompt is told plainly "no audit yet" rather than fed an empty object it might over-read.
 * The audit's own data_gaps come through verbatim so the model repeats no metric it cannot see.
 */
async function buildAuditSignals(): Promise<AuditSignals | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('instagram_audits')
    .select('facts, created_at')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // A missing audit is normal; a real error (bad policy, unapplied 0020) should not sink the
  // whole generation, so treat any failure as "no signals" and let the caller note it.
  if (error || !data) return null

  const facts = data.facts as Record<string, unknown> | null
  if (!facts) return null

  const profile = (facts.profile ?? {}) as Record<string, unknown>
  const engagement = (facts.engagement ?? {}) as Record<string, unknown>

  // Top few of each slice by post count, names only — enough to say "reels at 6–9pm land".
  const sliceLabels = (key: string, labelKey: string): string[] => {
    const rows = Array.isArray(facts[key]) ? (facts[key] as Record<string, unknown>[]) : []
    return rows
      .slice()
      .sort((a, b) => (Number(b.posts) || 0) - (Number(a.posts) || 0))
      .slice(0, 3)
      .map((row) => String(row[labelKey] ?? ''))
      .filter((label) => label.length > 0)
  }

  const hashtags = (facts.hashtags ?? {}) as Record<string, unknown>
  const topHashtags = Array.isArray(hashtags.top)
    ? (hashtags.top as Record<string, unknown>[]).slice(0, 10).map((row) => String(row.tag ?? '')).filter(Boolean)
    : []

  const keywords = Array.isArray(facts.caption_keywords)
    ? (facts.caption_keywords as Record<string, unknown>[]).slice(0, 15).map((row) => String(row.word ?? '')).filter(Boolean)
    : []

  return {
    username: String(profile.username ?? 'unknown'),
    as_of: typeof data.created_at === 'string' ? data.created_at : null,
    followers: typeof profile.followers === 'number' ? profile.followers : null,
    best_formats: sliceLabels('by_format', 'media_type'),
    best_times_ist: sliceLabels('by_time_of_day_ist', 'time_of_day_ist'),
    top_hashtags: topHashtags,
    caption_keywords: keywords,
    avg_engagement_rate_pct:
      typeof engagement.avg_engagement_rate_pct === 'number'
        ? engagement.avg_engagement_rate_pct
        : null,
    data_gaps: Array.isArray(facts.data_gaps) ? (facts.data_gaps as string[]) : [],
  }
}

/** Truncate one library row to a reference example the model can read without token bloat. */
function toReference(entry: ScriptLibraryEntry): ReferenceExample {
  return {
    source: entry.source,
    title: entry.title,
    content_type: entry.content_type,
    attribution: entry.attribution,
    // Enough to convey voice and structure; a full 3,000-char script times ten would swamp
    // the prompt without teaching the model anything the first 1,200 chars did not.
    body: entry.body.slice(0, 1200),
  }
}

/** Split the library into the three buckets the prompt distinguishes, newest first, capped. */
function bucketReferences(library: ScriptLibraryEntry[]) {
  const take = (source: ScriptSource | ScriptSource[], limit: number) => {
    const sources = Array.isArray(source) ? source : [source]
    return library
      .filter((entry) => sources.includes(entry.source))
      .slice(0, limit)
      .map(toReference)
  }
  return {
    own_examples: take('own', 4),
    contrast_examples: take(['competitor', 'inspiration'], 4),
    approved_examples: take('ai_approved', 4),
  }
}

// ===========================================================================
// Scripts — generate, list, approve, reject
// ===========================================================================

const SCRIPT_COLUMNS =
  'id, brief, content_type, status, facts, title, hook, script_body, caption, hashtags, seo_keywords, ai_generated, unavailable_reason, requested_by, approved_by, approved_at, created_at, updated_at, requester:users!marketing_scripts_requested_by_fkey(full_name), approver:users!marketing_scripts_approved_by_fkey(full_name)'

interface ScriptRow {
  id: string
  brief: string
  content_type: string
  status: string
  facts: unknown
  title: string | null
  hook: string | null
  script_body: string | null
  caption: string | null
  hashtags: string[] | null
  seo_keywords: string[] | null
  ai_generated: boolean
  unavailable_reason: string | null
  requested_by: string | null
  approved_by: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
  requester: { full_name: string | null } | { full_name: string | null }[] | null
  approver: { full_name: string | null } | { full_name: string | null }[] | null
}

function toScript(row: ScriptRow): MarketingScript {
  return {
    id: row.id,
    brief: row.brief,
    content_type: row.content_type as ScriptContentType,
    status: row.status as MarketingScript['status'],
    facts: row.facts as ScriptFacts,
    title: row.title,
    hook: row.hook,
    script_body: row.script_body,
    caption: row.caption,
    hashtags: row.hashtags,
    seo_keywords: row.seo_keywords,
    ai_generated: row.ai_generated,
    unavailable_reason: row.unavailable_reason,
    requested_by: row.requested_by,
    requested_by_name: embeddedName(row.requester),
    approved_by: row.approved_by,
    approved_by_name: embeddedName(row.approver),
    approved_at: row.approved_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listScripts(limit = 30): Promise<MarketingScript[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('marketing_scripts')
    .select(SCRIPT_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new ServiceError(error.message, 500)
  return ((data ?? []) as unknown as ScriptRow[]).map(toScript)
}

export interface GenerateScriptOptions {
  brief: string
  content_type: ScriptContentType
}

/**
 * Generate a script for a brief and store it as a draft.
 *
 * Assembles the grounding, runs the model, and inserts one row carrying BOTH the generated
 * pieces and the exact facts it was built from. AI-off is not an error: the row is stored with
 * ai_generated = false and a reason, and the team writes it themselves — the same contract as
 * every other AI feature. Returns the stored row so the caller need not re-read.
 */
export async function generateScriptForBrief(
  user: SessionUser,
  options: GenerateScriptOptions
): Promise<MarketingScript> {
  assertCanWrite(user)

  const [brandProfile, audit, library] = await Promise.all([
    getBrandProfile(),
    buildAuditSignals(),
    listLibrary(),
  ])

  const brand = toBrandContext(brandProfile)
  const buckets = bucketReferences(library)

  const facts: ScriptFacts = {
    brief: options.brief,
    content_type: options.content_type,
    brand,
    audit,
    ...buckets,
    had_grounding: Boolean(brand || audit),
  }

  const result = await generateScript(user, facts)
  const script = result.script

  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('marketing_scripts')
    .insert({
      organization_id: user.organization_id,
      brief: options.brief,
      content_type: options.content_type,
      status: 'draft',
      facts,
      title: script?.title ?? null,
      hook: script?.hook ?? null,
      script_body: script?.script_body ?? null,
      caption: script?.caption ?? null,
      hashtags: script?.hashtags ?? null,
      seo_keywords: script?.seo_keywords ?? null,
      ai_generated: script !== null,
      unavailable_reason: result.unavailableReason,
      requested_by: user.id,
    })
    .select(SCRIPT_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_script_generated',
    entityType: 'marketing_scripts',
    entityId: data.id,
    metadata: { content_type: options.content_type, ai_generated: script !== null },
  })

  return toScript(data as unknown as ScriptRow)
}

export interface UpdateScriptInput {
  title?: string | null
  hook?: string | null
  script_body?: string | null
  caption?: string | null
  hashtags?: string[] | null
  seo_keywords?: string[] | null
}

/** Save the team's edits to a draft before they approve it. */
export async function updateScript(
  user: SessionUser,
  scriptId: string,
  input: UpdateScriptInput
): Promise<MarketingScript> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('marketing_scripts')
    .update(input)
    .eq('id', scriptId)
    .select(SCRIPT_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Script not found', 404)

  return toScript(data as unknown as ScriptRow)
}

/**
 * Approve a script — and close the refinement loop.
 *
 * Two writes: flip the script to 'approved', and copy it into the reference library as
 * 'ai_approved' so every future generation is shown it. The copy is what the user meant by
 * "goes to training data": not fine-tuning, but a growing set of house-style examples the model
 * writes from. origin_script_id ties the reference back to this draft for traceability.
 *
 * Not transactional across the two statements — if the library copy failed after the status
 * flip, we would have an approved script that is not yet a reference, which is harmless and
 * self-heals on the next approval. A failure BEFORE the flip leaves a clean draft. Neither
 * state is corrupt, so the simplicity is worth more than a stored procedure here.
 */
export async function approveScript(user: SessionUser, scriptId: string): Promise<MarketingScript> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('marketing_scripts')
    .update({ status: 'approved', approved_by: user.id, approved_at: new Date().toISOString() })
    .eq('id', scriptId)
    .select(SCRIPT_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Script not found', 404)

  const script = toScript(data as unknown as ScriptRow)

  // Only a script with actual body text is worth keeping as an example. An AI-off placeholder
  // the team never filled in would teach the next generation nothing.
  const body = script.script_body?.trim()
  if (body) {
    const referenceBody = [script.hook, body, script.caption]
      .filter((part) => part && part.trim().length > 0)
      .join('\n\n')

    const { error: libError } = await supabase.from('marketing_script_library').insert({
      organization_id: user.organization_id,
      source: 'ai_approved',
      title: script.title ?? `Approved ${script.content_type}`,
      body: referenceBody,
      content_type: script.content_type,
      platform: 'instagram',
      origin_script_id: script.id,
      added_by: user.id,
    })
    // A failed copy must not fail the approval — the status flip already succeeded and the
    // user's action is done. Log and move on; the next approval re-establishes the loop.
    if (libError) console.error('[marketing-creative] approved-script library copy failed', libError)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_script_approved',
    entityType: 'marketing_scripts',
    entityId: script.id,
  })

  return script
}

export async function rejectScript(user: SessionUser, scriptId: string): Promise<MarketingScript> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('marketing_scripts')
    .update({ status: 'rejected' })
    .eq('id', scriptId)
    .select(SCRIPT_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 400)
  if (!data) throw new ServiceError('Script not found', 404)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_script_rejected',
    entityType: 'marketing_scripts',
    entityId: scriptId,
  })

  return toScript(data as unknown as ScriptRow)
}

// ===========================================================================
// Content plans — the AI Calendar (propose → commit)
// ===========================================================================

const PLAN_COLUMNS =
  'id, range_kind, start_date, end_date, brief, status, facts, items, ai_generated, unavailable_reason, created_by, committed_by, committed_at, created_at, updated_at, creator:users!marketing_content_plans_created_by_fkey(full_name)'

interface PlanRow {
  id: string
  range_kind: string
  start_date: string
  end_date: string
  brief: string | null
  status: string
  facts: unknown
  items: unknown
  ai_generated: boolean
  unavailable_reason: string | null
  created_by: string | null
  committed_by: string | null
  committed_at: string | null
  created_at: string
  updated_at: string
  creator: { full_name: string | null } | { full_name: string | null }[] | null
}

function toPlan(row: PlanRow): ContentPlan {
  return {
    id: row.id,
    range_kind: row.range_kind as PlanRangeKind,
    start_date: row.start_date,
    end_date: row.end_date,
    brief: row.brief,
    status: row.status as ContentPlan['status'],
    facts: row.facts as PlanFacts,
    items: (Array.isArray(row.items) ? row.items : []) as ContentPlan['items'],
    ai_generated: row.ai_generated,
    unavailable_reason: row.unavailable_reason,
    created_by: row.created_by,
    created_by_name: embeddedName(row.creator),
    committed_by: row.committed_by,
    committed_at: row.committed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function listPlans(limit = 10): Promise<ContentPlan[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('marketing_content_plans')
    .select(PLAN_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new ServiceError(error.message, 500)
  return ((data ?? []) as unknown as PlanRow[]).map(toPlan)
}

/** The dates in a range, inclusive, as 'YYYY-MM-DD' in UTC (calendar dates carry no time). */
function datesInRange(startISO: string, days: number): string[] {
  const start = new Date(`${startISO}T00:00:00Z`).getTime()
  const dates: string[] = []
  for (let i = 0; i < days; i += 1) {
    dates.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10))
  }
  return dates
}

export interface GeneratePlanOptions {
  range_kind: PlanRangeKind
  start_date: string
  brief?: string | null
}

/**
 * Propose a week or month of content. Nothing touches the live calendar here — the plan is
 * stored as 'proposed' and the team commits the parts it wants separately.
 */
export async function generatePlanForRange(
  user: SessionUser,
  options: GeneratePlanOptions
): Promise<ContentPlan> {
  assertCanWrite(user)

  const days = options.range_kind === 'month' ? 30 : 7
  const dates = datesInRange(options.start_date, days)
  const endDate = dates[dates.length - 1]

  const [brandProfile, audit] = await Promise.all([getBrandProfile(), buildAuditSignals()])
  const brand = toBrandContext(brandProfile)

  // Titles already scheduled in or near the range, so the model does not propose duplicates.
  const supabase = await createSupabaseServerClient()
  const { data: existing } = await supabase
    .from('content_calendar_items')
    .select('title')
    .gte('scheduled_date', options.start_date)
    .lte('scheduled_date', endDate)

  const existingTitles = ((existing ?? []) as { title: string }[]).map((row) => row.title)

  const facts: PlanFacts = {
    range_kind: options.range_kind,
    start_date: options.start_date,
    end_date: endDate,
    dates,
    brief: options.brief ?? null,
    brand,
    audit,
    existing_titles: existingTitles,
  }

  const result = await generatePlan(user, facts)

  const { data, error } = await supabase
    .from('marketing_content_plans')
    .insert({
      organization_id: user.organization_id,
      range_kind: options.range_kind,
      start_date: options.start_date,
      end_date: endDate,
      brief: options.brief ?? null,
      status: 'proposed',
      facts,
      items: result.items,
      ai_generated: result.items.length > 0,
      unavailable_reason: result.unavailableReason,
      created_by: user.id,
    })
    .select(PLAN_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_content_plan_generated',
    entityType: 'marketing_content_plans',
    entityId: data.id,
    metadata: { range_kind: options.range_kind, item_count: result.items.length },
  })

  return toPlan(data as unknown as PlanRow)
}

/**
 * Commit selected items from a proposed plan into real content_calendar_items.
 *
 * THE ONE PLACE THIS FEATURE TOUCHES THE LIVE CALENDAR, and only on explicit commit. Committed
 * items are owned by the committer (content_calendar_items.assigned_to is NOT NULL and drives
 * daily reminders — 0014), status 'planned', so the team reassigns owners afterward. Item
 * indices are validated against the stored plan, so a caller cannot smuggle in a calendar row
 * that was never proposed. The plan is then marked 'committed'.
 */
export async function commitPlan(
  user: SessionUser,
  planId: string,
  itemIndices: number[]
): Promise<{ committed: number }> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { data: planData, error: planError } = await supabase
    .from('marketing_content_plans')
    .select(PLAN_COLUMNS)
    .eq('id', planId)
    .maybeSingle()

  if (planError) throw new ServiceError(planError.message, 500)
  if (!planData) throw new ServiceError('Content plan not found', 404)

  const plan = toPlan(planData as unknown as PlanRow)
  if (plan.status === 'committed') {
    throw new ServiceError('This plan has already been committed', 409)
  }

  // Only the indices that actually exist in the stored plan; ignore anything out of range so a
  // stale or hand-edited request cannot create a calendar item that was never proposed.
  const chosen = itemIndices
    .filter((index) => Number.isInteger(index) && index >= 0 && index < plan.items.length)
    .map((index) => plan.items[index])

  if (chosen.length === 0) {
    throw new ServiceError('Select at least one item to add to the calendar', 400)
  }

  const rows = chosen.map((item) => ({
    organization_id: user.organization_id,
    // 'story' has no home in content_calendar_items' reel/post/story/ad_creative set beyond
    // 'story' itself, which it supports — pass it through; anything else is a reel or post.
    content_type: item.content_type,
    title: item.title,
    platform: 'instagram',
    scheduled_date: item.scheduled_date,
    status: 'planned',
    assigned_to: user.id,
    caption_draft: item.caption_idea ?? null,
    notes: item.rationale ? `AI plan: ${item.rationale}` : null,
    created_by: user.id,
  }))

  const { error: insertError } = await supabase.from('content_calendar_items').insert(rows)
  if (insertError) throw new ServiceError(insertError.message, 400)

  const { error: updateError } = await supabase
    .from('marketing_content_plans')
    .update({ status: 'committed', committed_by: user.id, committed_at: new Date().toISOString() })
    .eq('id', planId)
  if (updateError) throw new ServiceError(updateError.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_content_plan_committed',
    entityType: 'marketing_content_plans',
    entityId: planId,
    metadata: { items_committed: chosen.length },
  })

  return { committed: chosen.length }
}

export async function discardPlan(user: SessionUser, planId: string): Promise<void> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const { error } = await supabase
    .from('marketing_content_plans')
    .update({ status: 'discarded' })
    .eq('id', planId)
  if (error) throw new ServiceError(error.message, 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'marketing_content_plan_discarded',
    entityType: 'marketing_content_plans',
    entityId: planId,
  })
}
