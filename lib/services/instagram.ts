import 'server-only'

import { randomBytes } from 'node:crypto'

import { createSupabaseServerClient, createSupabaseServiceClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { computeAuditFacts, extractHashtags } from '@/lib/instagram/metrics'
import { buildInstagramAuditNarrative } from '@/lib/ai/instagram-audit'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  InstagramAccount,
  InstagramAudit,
  InstagramMediaType,
  InstagramPostRow,
  InstagramSyncPayload,
} from '@/lib/instagram/types'

export { ServiceError }

/**
 * Instagram audit service layer — 0020.
 *
 * WHO CAN READ WHAT is settled by RLS: the Marketing department plus the CEO read
 * everything, the same rule ai_marketing_insights (0014) uses. This layer exists for the
 * four things RLS cannot do.
 *
 * 1. NORMALISE THE HANDLE. '@SolarPulse', 'solarpulse ' and 'solarpulse' are one account.
 *    Lowercasing in one place is what makes the unique index meaningful.
 *
 * 2. AUTHENTICATE THE LOCAL TOOL. The scraper runs on somebody's laptop with no ERP
 *    session, so it presents a short-lived single-use token instead. Issuing and consuming
 *    that token are the only two places in this file that touch the service-role client for
 *    auth reasons, and both do it after an explicit guard.
 *
 * 3. REFUSE TO INVENT AN ACCOUNT. A sync can only fill in an account a Marketing member
 *    already connected through the UI. applySyncPayload looks the handle up and fails if it
 *    is not connected — so a leaked token cannot be used to create records for an arbitrary
 *    Instagram profile, only to update the one the team chose.
 *
 * 4. WRITE POSTS AND AUDITS THROUGH THE SERVICE CLIENT. Neither table has a client insert
 *    policy, by design (see 0020). A client that could insert posts could fabricate the
 *    evidence an audit rests on; a client that could insert an audit could publish a
 *    narrative the numbers do not support.
 *
 * NO INSTAGRAM CREDENTIAL PASSES THROUGH HERE. The operator logs into Instagram in their
 * own browser. There is no parameter, column or log field in this file that could carry a
 * password, and the sync payload has no place to put one.
 */

/** Long enough to be unguessable, short enough to paste. */
const SYNC_TOKEN_BYTES = 32

/**
 * Minutes a sync token stays valid. Deliberately tight: the operator generates it, pastes
 * it into the tool, and runs the tool — that is a two-minute errand, not a standing key.
 */
export const SYNC_TOKEN_TTL_MINUTES = 30

/** Instagram's own handle rules: letters, digits, dots, underscores, up to 30 characters. */
const USERNAME_PATTERN = /^[a-z0-9._]{1,30}$/

const MEDIA_TYPES: InstagramMediaType[] = ['image', 'carousel', 'reel', 'video']

/** Captions cap at 2,200 characters on Instagram; the slack absorbs entity-escaping. */
const MAX_CAPTION_LENGTH = 3000

/** One sync's worth of grid. Beyond this the scraper is looping, not collecting. */
const MAX_POSTS_PER_SYNC = 500

const ACCOUNT_COLUMNS = `
  id, organization_id, username, display_name, biography, category, external_url,
  is_professional, follower_count, following_count, post_count, sync_status, sync_error,
  last_synced_at, connected_by, created_at,
  connected_user:users!instagram_accounts_connected_by_fkey(full_name)
`

const POST_COLUMNS =
  'shortcode, media_type, carousel_count, caption, hashtags, like_count, comment_count, view_count, posted_at'

const AUDIT_COLUMNS = `
  id, account_id, requested_by, facts, narrative, unavailable_reason, ai_generated,
  posts_analysed, window_start, window_end, created_at,
  requester:users!instagram_audits_requested_by_fkey(full_name)
`

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/**
 * '@SolarPulse' → 'solarpulse'. Also accepts a pasted profile URL, because that is what
 * someone actually has on their clipboard.
 */
export function normaliseUsername(raw: string): string {
  let value = raw.trim()

  const urlMatch = value.match(/instagram\.com\/([^/?#]+)/i)
  if (urlMatch) value = urlMatch[1]

  value = value.replace(/^@/, '').trim().toLowerCase()

  if (!USERNAME_PATTERN.test(value)) {
    throw new ServiceError(
      'That does not look like an Instagram username. Use the handle itself, for example solarpulse.',
      400
    )
  }
  return value
}

function coerceMediaType(raw: string | null | undefined): InstagramMediaType | null {
  if (!raw) return null
  const value = raw.trim().toLowerCase()
  return MEDIA_TYPES.includes(value as InstagramMediaType) ? (value as InstagramMediaType) : null
}

/**
 * A counter, or null. Rejects negatives and non-integers rather than storing them: a
 * scraper that read "1.2K" and parsed it badly should produce a gap the audit reports,
 * not a plausible-looking wrong number.
 */
function coerceCount(raw: number | null | undefined): number | null {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null
  if (raw < 0) return null
  return Math.round(raw)
}

function coerceTimestamp(raw: string | null | undefined): string | null {
  if (!raw) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return null
  // A post dated in the future or before Instagram existed is a parse failure, not a post.
  const year = parsed.getUTCFullYear()
  if (year < 2010 || parsed.getTime() > Date.now() + 86_400_000) return null
  return parsed.toISOString()
}

// ---------------------------------------------------------------------------
// Reads — RLS client, so a non-Marketing caller simply sees nothing
// ---------------------------------------------------------------------------

interface AccountQueryRow {
  id: string
  organization_id: string
  username: string
  display_name: string | null
  biography: string | null
  category: string | null
  external_url: string | null
  is_professional: boolean | null
  follower_count: number | null
  following_count: number | null
  post_count: number | null
  sync_status: string
  sync_error: string | null
  last_synced_at: string | null
  connected_by: string | null
  created_at: string
  connected_user: { full_name: string | null } | { full_name: string | null }[] | null
}

/** Supabase types an embedded to-one as either an object or an array depending on the hint. */
function firstName(embedded: { full_name: string | null } | { full_name: string | null }[] | null) {
  if (!embedded) return null
  return Array.isArray(embedded) ? (embedded[0]?.full_name ?? null) : embedded.full_name
}

function toAccount(row: AccountQueryRow): InstagramAccount {
  return {
    id: row.id,
    username: row.username,
    display_name: row.display_name,
    biography: row.biography,
    category: row.category,
    external_url: row.external_url,
    is_professional: row.is_professional,
    follower_count: row.follower_count,
    following_count: row.following_count,
    post_count: row.post_count,
    last_synced_at: row.last_synced_at,
    sync_status: row.sync_status,
    sync_error: row.sync_error,
    connected_by: row.connected_by,
    connected_by_name: firstName(row.connected_user),
    created_at: row.created_at,
  }
}

/**
 * Every connected account for the caller's org, newest first.
 *
 * A list rather than a single row even though most companies connect one handle: a brand
 * with a separate training or regional account is ordinary, and the schema already allows
 * it. The UI picks the first when there is only one.
 */
export async function listConnectedAccounts(): Promise<InstagramAccount[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select(ACCOUNT_COLUMNS)
    .order('created_at', { ascending: true })

  if (error) throw new ServiceError(error.message, 500)
  return ((data ?? []) as unknown as AccountQueryRow[]).map(toAccount)
}

export async function getAccount(accountId: string): Promise<InstagramAccount | null> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('instagram_accounts')
    .select(ACCOUNT_COLUMNS)
    .eq('id', accountId)
    .maybeSingle()

  if (error) throw new ServiceError(error.message, 500)
  return data ? toAccount(data as unknown as AccountQueryRow) : null
}

/** Stored posts for one account, newest first. The raw material for every metric. */
export async function listPosts(accountId: string): Promise<InstagramPostRow[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('instagram_posts')
    .select(POST_COLUMNS)
    .eq('account_id', accountId)
    .order('posted_at', { ascending: false, nullsFirst: false })
    .limit(MAX_POSTS_PER_SYNC)

  if (error) throw new ServiceError(error.message, 500)
  return (data ?? []) as InstagramPostRow[]
}

/**
 * How many posts are stored for one account.
 *
 * A separate count query rather than `listPosts(id).length`, because the panel wants only
 * the number and pulling five hundred captions to call `.length` on them would be a waste
 * of a round trip. `head: true` sends no rows at all.
 */
export async function countPosts(accountId: string): Promise<number> {
  const supabase = await createSupabaseServerClient()
  const { count, error } = await supabase
    .from('instagram_posts')
    .select('id', { count: 'exact', head: true })
    .eq('account_id', accountId)

  if (error) throw new ServiceError(error.message, 500)
  return count ?? 0
}

interface AuditQueryRow {
  id: string
  account_id: string
  requested_by: string | null
  facts: unknown
  narrative: string | null
  unavailable_reason: string | null
  ai_generated: boolean
  posts_analysed: number
  window_start: string | null
  window_end: string | null
  created_at: string
  requester: { full_name: string | null } | { full_name: string | null }[] | null
}

function toAudit(row: AuditQueryRow): InstagramAudit {
  return {
    id: row.id,
    account_id: row.account_id,
    requested_by: row.requested_by,
    requested_by_name: firstName(row.requester),
    facts: row.facts as InstagramAudit['facts'],
    narrative: row.narrative,
    unavailable_reason: row.unavailable_reason,
    ai_generated: row.ai_generated,
    posts_analysed: row.posts_analysed,
    window_start: row.window_start,
    window_end: row.window_end,
    created_at: row.created_at,
  }
}

export async function listAudits(accountId: string, limit = 10): Promise<InstagramAudit[]> {
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase
    .from('instagram_audits')
    .select(AUDIT_COLUMNS)
    .eq('account_id', accountId)
    .order('created_at', { ascending: false })
    .limit(limit)

  if (error) throw new ServiceError(error.message, 500)
  return ((data ?? []) as unknown as AuditQueryRow[]).map(toAudit)
}

// ---------------------------------------------------------------------------
// Connect and disconnect — RLS client, as the Marketing member
// ---------------------------------------------------------------------------

/**
 * Connect a handle. Creates the row a later sync fills in; collects nothing itself.
 *
 * Runs on the RLS client on purpose: the marketing_connect_instagram_accounts policy is
 * what authorises this, so a non-Marketing caller who reached the route anyway is refused
 * by the database rather than only by the guard above it.
 */
export async function connectAccount(user: SessionUser, rawUsername: string): Promise<InstagramAccount> {
  const username = normaliseUsername(rawUsername)
  const supabase = await createSupabaseServerClient()

  const { data, error } = await supabase
    .from('instagram_accounts')
    .insert({
      organization_id: user.organization_id,
      username,
      connected_by: user.id,
      sync_status: 'never',
    })
    .select(ACCOUNT_COLUMNS)
    .single()

  if (error) {
    // 23505 = unique violation on (organization_id, lower(username)).
    if (error.code === '23505') {
      throw new ServiceError(`@${username} is already connected.`, 409)
    }
    throw new ServiceError(error.message, 500)
  }

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'instagram.account.connected',
    entityType: 'instagram_account',
    entityId: data.id,
    metadata: { username },
  })

  return toAccount(data as unknown as AccountQueryRow)
}

/**
 * Disconnect. Cascades to posts and audits, which is the intent — disconnecting is also
 * the only way to erase collected data, since there is no per-post delete.
 */
export async function disconnectAccount(user: SessionUser, accountId: string): Promise<void> {
  const existing = await getAccount(accountId)
  if (!existing) throw new ServiceError('That account is not connected.', 404)

  const supabase = await createSupabaseServerClient()
  const { error } = await supabase.from('instagram_accounts').delete().eq('id', accountId)
  if (error) throw new ServiceError(error.message, 500)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'instagram.account.disconnected',
    entityType: 'instagram_account',
    entityId: accountId,
    metadata: { username: existing.username },
  })
}

// ---------------------------------------------------------------------------
// Sync tokens — service client, because instagram_sync_tokens denies every client
// ---------------------------------------------------------------------------

/**
 * Mint a short-lived single-use token for the local tool.
 *
 * The plaintext is returned ONCE, to the member who asked, and is never read back through
 * any route — there is no endpoint that lists tokens, and RLS denies the table to every
 * client, so the only copy after this returns is the one in the operator's terminal.
 *
 * The caller MUST have guarded on Marketing membership before calling this. The service
 * client bypasses RLS, so this function cannot check for itself.
 */
export async function issueSyncToken(
  user: SessionUser
): Promise<{ token: string; expiresAt: string }> {
  const token = randomBytes(SYNC_TOKEN_BYTES).toString('base64url')
  const expiresAt = new Date(Date.now() + SYNC_TOKEN_TTL_MINUTES * 60_000).toISOString()

  const supabase = createSupabaseServiceClient()
  const { error } = await supabase.from('instagram_sync_tokens').insert({
    organization_id: user.organization_id,
    user_id: user.id,
    token,
    expires_at: expiresAt,
  })

  if (error) throw new ServiceError(error.message, 500)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'instagram.sync_token.issued',
    entityType: 'instagram_sync_token',
    // The token value itself is deliberately NOT in the metadata. Same rule that keeps
    // passwords out of audit rows — an audit log is not a credential store.
    metadata: { expires_at: expiresAt, ttl_minutes: SYNC_TOKEN_TTL_MINUTES },
  })

  return { token, expiresAt }
}

export interface SyncActor {
  userId: string
  organizationId: string
}

/**
 * Validate and burn a token. Returns who it was for, or null for anything wrong —
 * unknown, expired, or already used. Null rather than a reason on purpose: the caller
 * turns all three into one 401, so a probe cannot learn which of them it hit.
 *
 * Stamping used_at BEFORE the sync runs, not after, is what makes it single-use even if
 * the sync then fails. A retry needs a fresh token, which is a deliberate cost: it means a
 * token intercepted mid-flight is already spent.
 */
export async function consumeSyncToken(token: string): Promise<SyncActor | null> {
  if (!token || token.length < 20) return null

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('instagram_sync_tokens')
    .select('id, user_id, organization_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle()

  if (error || !data) return null
  if (data.used_at) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null

  const { error: burnError } = await supabase
    .from('instagram_sync_tokens')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id)
    .is('used_at', null)

  if (burnError) return null

  return { userId: data.user_id, organizationId: data.organization_id }
}

// ---------------------------------------------------------------------------
// Applying a sync — service client, after the token resolved to a real member
// ---------------------------------------------------------------------------

export interface SyncResult {
  accountId: string
  username: string
  postsWritten: number
  postsRejected: number
}

/**
 * Store what the local tool collected.
 *
 * Refuses a handle nobody connected. That is the security property that makes a token
 * narrow: it can refresh the account the Marketing team chose, and it can do nothing else
 * — not create a record for a competitor's profile, not seed an audit for a handle the
 * team never approved.
 *
 * Posts are upserted on (account_id, shortcode), so re-running the tool refreshes counters
 * in place instead of duplicating the grid. Rows that arrive without a usable shortcode are
 * counted in postsRejected and dropped — a post we cannot identify cannot be updated later.
 */
export async function applySyncPayload(
  payload: InstagramSyncPayload,
  actor: SyncActor
): Promise<SyncResult> {
  const username = normaliseUsername(payload.username)
  const supabase = createSupabaseServiceClient()

  const { data: account, error: lookupError } = await supabase
    .from('instagram_accounts')
    .select('id, username')
    .eq('organization_id', actor.organizationId)
    .ilike('username', username)
    .maybeSingle()

  if (lookupError) throw new ServiceError(lookupError.message, 500)
  if (!account) {
    throw new ServiceError(
      `@${username} is not connected in the ERP. Connect it under Marketing → AI Insights first, then run the sync again.`,
      404
    )
  }

  // --- posts -------------------------------------------------------------
  const seen = new Set<string>()
  let postsRejected = 0
  const rows = []

  for (const post of payload.posts.slice(0, MAX_POSTS_PER_SYNC)) {
    const shortcode = typeof post.shortcode === 'string' ? post.shortcode.trim() : ''
    if (!shortcode || shortcode.length > 64 || seen.has(shortcode)) {
      postsRejected += 1
      continue
    }
    seen.add(shortcode)

    const caption =
      typeof post.caption === 'string' ? post.caption.slice(0, MAX_CAPTION_LENGTH) : null

    rows.push({
      organization_id: actor.organizationId,
      account_id: account.id,
      shortcode,
      media_type: coerceMediaType(post.media_type),
      carousel_count: coerceCount(post.carousel_count),
      caption,
      // Extracted here, once, so every reader of the row agrees on the tags. metrics.ts
      // can still parse a caption itself, for rows written before this existed.
      hashtags: caption === null ? null : extractHashtags(caption),
      like_count: coerceCount(post.like_count),
      comment_count: coerceCount(post.comment_count),
      view_count: coerceCount(post.view_count),
      posted_at: coerceTimestamp(post.posted_at),
      scraped_at: new Date().toISOString(),
    })
  }

  if (rows.length > 0) {
    const { error: upsertError } = await supabase
      .from('instagram_posts')
      .upsert(rows, { onConflict: 'account_id,shortcode' })
    if (upsertError) throw new ServiceError(upsertError.message, 500)
  }

  // --- profile ------------------------------------------------------------
  // Only the fields the tool actually read. `?? null` would blank a good stored value
  // when a later sync could not see the bio, so undefined is skipped instead.
  const profileUpdate: Record<string, unknown> = {
    sync_status: payload.partial ? 'partial' : 'ok',
    sync_error: payload.partial ? (payload.notes?.slice(0, 500) ?? 'Collected only part of the profile.') : null,
    last_synced_at: new Date().toISOString(),
  }

  const { profile } = payload
  if (profile.display_name !== undefined) profileUpdate.display_name = profile.display_name
  if (profile.biography !== undefined) profileUpdate.biography = profile.biography
  if (profile.category !== undefined) profileUpdate.category = profile.category
  if (profile.external_url !== undefined) profileUpdate.external_url = profile.external_url
  if (profile.is_professional !== undefined) profileUpdate.is_professional = profile.is_professional
  if (profile.follower_count !== undefined)
    profileUpdate.follower_count = coerceCount(profile.follower_count)
  if (profile.following_count !== undefined)
    profileUpdate.following_count = coerceCount(profile.following_count)
  if (profile.post_count !== undefined) profileUpdate.post_count = coerceCount(profile.post_count)

  const { error: updateError } = await supabase
    .from('instagram_accounts')
    .update(profileUpdate)
    .eq('id', account.id)

  if (updateError) throw new ServiceError(updateError.message, 500)

  await logAction({
    organizationId: actor.organizationId,
    userId: actor.userId,
    action: 'instagram.account.synced',
    entityType: 'instagram_account',
    entityId: account.id,
    metadata: {
      username,
      posts_written: rows.length,
      posts_rejected: postsRejected,
      partial: Boolean(payload.partial),
    },
  })

  return {
    accountId: account.id,
    username,
    postsWritten: rows.length,
    postsRejected,
  }
}

// ---------------------------------------------------------------------------
// Generating an audit
// ---------------------------------------------------------------------------

export interface GenerateAuditOptions {
  accountId: string
  /** Days back from today, or null for every stored post. */
  days: number | null
}

/**
 * Compute the figures, ask the model to phrase them, store both.
 *
 * The reads run on the RLS client as the caller, so an audit can never contain data the
 * caller could not already see. The write runs on the service client, because
 * instagram_audits has no client insert policy — see the header.
 *
 * A missing narrative is a normal, stored outcome. When AI is off the facts are still the
 * audit; unavailable_reason records why there are no words with them.
 */
export async function generateAudit(
  user: SessionUser,
  options: GenerateAuditOptions
): Promise<InstagramAudit> {
  const account = await getAccount(options.accountId)
  if (!account) throw new ServiceError('That account is not connected.', 404)

  const posts = await listPosts(account.id)
  if (posts.length === 0) {
    throw new ServiceError(
      'No posts have been collected for this account yet. Run the sync tool first, then generate the audit.',
      409
    )
  }

  const asOf = new Date()
  const windowStart = options.days
    ? new Date(asOf.getTime() - options.days * 86_400_000)
    : null

  const facts = computeAuditFacts(account, posts, { windowStart, windowEnd: null, asOf })

  if (facts.window.posts_analysed === 0) {
    throw new ServiceError(
      `No posts fall within the last ${options.days} days. Choose a longer window, or run the sync tool again.`,
      409
    )
  }

  const { narrative, unavailableReason } = await buildInstagramAuditNarrative(user, facts)

  const supabase = createSupabaseServiceClient()
  const { data, error } = await supabase
    .from('instagram_audits')
    .insert({
      organization_id: user.organization_id,
      account_id: account.id,
      requested_by: user.id,
      facts,
      narrative,
      unavailable_reason: unavailableReason,
      ai_generated: narrative !== null,
      posts_analysed: facts.window.posts_analysed,
      window_start: windowStart ? windowStart.toISOString().slice(0, 10) : null,
      window_end: asOf.toISOString().slice(0, 10),
    })
    .select(AUDIT_COLUMNS)
    .single()

  if (error) throw new ServiceError(error.message, 500)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'instagram.audit.generated',
    entityType: 'instagram_audit',
    entityId: data.id,
    metadata: {
      username: account.username,
      posts_analysed: facts.window.posts_analysed,
      window_days: options.days,
      ai_generated: narrative !== null,
    },
  })

  return toAudit(data as unknown as AuditQueryRow)
}
