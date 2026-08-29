/**
 * Instagram audit types.
 *
 * Split out from metrics.ts so the client components that render an audit can import the
 * shape without pulling in the computation, and so the scraper's payload contract lives
 * next to the facts contract it eventually feeds.
 *
 * The `| null` on nearly every number here is the schema's promise, restated in the type
 * system: null means "could not be read", never zero. See metrics.ts for why.
 */

// ---------------------------------------------------------------------------
// Database row shapes
// ---------------------------------------------------------------------------

/** 'never' | 'ok' | 'partial' | 'failed' — plain text, per the 0020 convention. */
export type InstagramSyncStatus = 'never' | 'ok' | 'partial' | 'failed'

/** 'image' | 'carousel' | 'reel' | 'video' — plain text, per the 0020 convention. */
export type InstagramMediaType = 'image' | 'carousel' | 'reel' | 'video'

/**
 * instagram_accounts, as the audit needs it. Narrower than the table on purpose: the
 * metrics never see created_at or connected_by, so they are not in the contract.
 */
export interface InstagramProfileRow {
  id: string
  username: string
  display_name: string | null
  biography: string | null
  category: string | null
  external_url: string | null
  is_professional: boolean | null
  follower_count: number | null
  following_count: number | null
  post_count: number | null
  last_synced_at: string | null
}

/** instagram_accounts as the UI needs it — the profile plus its sync state. */
export interface InstagramAccount extends InstagramProfileRow {
  sync_status: string
  sync_error: string | null
  connected_by: string | null
  connected_by_name: string | null
  created_at: string
}

export interface InstagramPostRow {
  shortcode: string
  media_type: string | null
  carousel_count: number | null
  caption: string | null
  hashtags: string[] | null
  like_count: number | null
  comment_count: number | null
  view_count: number | null
  posted_at: string | null
}

// ---------------------------------------------------------------------------
// Computed facts
// ---------------------------------------------------------------------------

/**
 * The shared "how did this slice perform" shape. `posts` is the slice size;
 * `engagement_sample` is how many of those had a readable like or comment count, so an
 * average over 4 of 30 is never mistaken for an average over 30.
 */
export interface InstagramSliceStats {
  posts: number
  engagement_sample: number
  avg_interactions: number | null
  avg_likes: number | null
  avg_comments: number | null
  avg_engagement_rate_pct: number | null
}

export interface InstagramPostHighlight {
  shortcode: string
  media_type: string | null
  posted_at_ist: string | null
  likes: number | null
  comments: number | null
  views: number | null
  interactions: number
  engagement_rate_pct: number | null
  hashtags: string[] | null
  caption_excerpt: string | null
}

/**
 * The exact payload handed to the model, and the exact payload stored in
 * instagram_audits.facts. One shape for both, so what a reader inspects afterwards is
 * literally what the model saw.
 */
export interface InstagramAuditFacts {
  profile: {
    username: string
    display_name: string | null
    category: string | null
    biography: string | null
    external_url: string | null
    is_professional_account: boolean | null
    followers: number | null
    following: number | null
    posts_on_profile_total: number | null
    last_synced_at: string | null
  }
  window: {
    start: string | null
    end: string | null
    posts_analysed: number
    posts_with_timestamp: number
    earliest_post_ist: string | null
    latest_post_ist: string | null
  }
  cadence: {
    posts_per_week: number | null
    longest_gap_days: number | null
    days_since_last_post: number | null
  }
  engagement: {
    /** Spelled out for the model so it cannot describe a followers-based rate as reach. */
    metric_definition: string
    engagement_sample: number
    avg_interactions: number | null
    median_interactions: number | null
    avg_likes: number | null
    avg_comments: number | null
    avg_views: number | null
    total_interactions: number | null
    avg_engagement_rate_pct: number | null
    best_engagement_rate_pct: number | null
  }
  by_format: Array<InstagramSliceStats & { media_type: string }>
  by_weekday_ist: Array<InstagramSliceStats & { weekday: string }>
  by_time_of_day_ist: Array<InstagramSliceStats & { time_of_day_ist: string }>
  by_caption_length: Array<InstagramSliceStats & { caption_length: string }>
  top_posts: InstagramPostHighlight[]
  weakest_posts: InstagramPostHighlight[]
  hashtags: {
    distinct_used: number
    posts_without_hashtags: number
    top: Array<InstagramSliceStats & { tag: string }>
  }
  caption_keywords: Array<{ word: string; posts: number }>
  /** Plain-language list of what could not be read. The prompt requires acknowledging these. */
  data_gaps: string[]
}

// ---------------------------------------------------------------------------
// Stored audits
// ---------------------------------------------------------------------------

export interface InstagramAudit {
  id: string
  account_id: string
  requested_by: string | null
  requested_by_name: string | null
  facts: InstagramAuditFacts
  narrative: string | null
  unavailable_reason: string | null
  ai_generated: boolean
  posts_analysed: number
  window_start: string | null
  window_end: string | null
  created_at: string
}

// ---------------------------------------------------------------------------
// The scraper's wire contract
// ---------------------------------------------------------------------------

/**
 * What the local tool POSTs to /api/instagram/sync. Mirrored by the Zod schema in
 * lib/validation/schemas.ts, which is the enforcing copy — this interface is for the
 * TypeScript side of the same agreement.
 *
 * Note what is NOT here: no password, no session cookie, no Instagram token. The
 * operator logs in interactively in their own browser, so there is nothing of that kind
 * for the tool to send and no field here that could carry it.
 */
export interface InstagramSyncPayload {
  username: string
  profile: {
    display_name?: string | null
    biography?: string | null
    category?: string | null
    external_url?: string | null
    is_professional?: boolean | null
    follower_count?: number | null
    following_count?: number | null
    post_count?: number | null
  }
  posts: Array<{
    shortcode: string
    media_type?: string | null
    carousel_count?: number | null
    caption?: string | null
    like_count?: number | null
    comment_count?: number | null
    view_count?: number | null
    posted_at?: string | null
  }>
  /** Set by the tool when it knows it collected less than it tried to. Drives sync_status. */
  partial?: boolean
  notes?: string | null
}
