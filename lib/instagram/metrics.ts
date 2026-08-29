import type { InstagramAuditFacts, InstagramPostRow, InstagramProfileRow } from './types'

/**
 * Instagram audit metrics.
 *
 * THIS FILE IS THE AI RULE. Every figure an audit contains is computed here, from rows
 * this system stored, and handed to the model finished. The model is asked only to
 * phrase them — it is never the source of a figure, so it cannot invent one. The same
 * contract lib/ai/summary.ts and lib/ai/employee-report.ts state for their own numbers.
 *
 * TWO CONVENTIONS RUN THROUGH ALL OF IT.
 *
 * 1. null means "could not be read", never zero. Instagram hides like counts on some
 *    posts, view counts exist only on video, and a grid tile can fail to yield a
 *    timestamp. Averaging those as 0 would quietly invent a bad month. So every
 *    aggregate skips nulls, and every aggregate reports the `sample` it was actually
 *    computed from — an average over 4 of 30 posts is a different claim from an average
 *    over 30, and the model is given both numbers so it can say which it has.
 *
 * 2. Not enough data returns null, not a placeholder. mean([]) is null. An engagement
 *    rate with no follower count is null. `dataGaps` then names each gap in plain words,
 *    which is what the prompt tells the model to acknowledge instead of guessing.
 *
 * WHAT IS DELIBERATELY MISSING: reach, impressions, saves, shares, profile visits. The
 * local tool reads what a logged-in viewer of the profile can see, and those five are
 * not on that page. There is no column for them and no metric derived from them — so
 * "engagement rate" here is over FOLLOWERS, which is the reach-free definition, and it
 * is labelled that way in the facts so the model cannot describe it as reach-based.
 */

/** Asia/Kolkata, fixed. India has no DST, so a constant offset is exact rather than lazy. */
const IST_OFFSET_MINUTES = 330

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Caption words too common to signal a niche. Deliberately short: this is a
 * stopword list, not an editorial filter, and anything domain-specific
 * (solar, subsidy, rooftop) must survive it or the niche read is worthless.
 */
const STOPWORDS = new Set([
  'a', 'about', 'after', 'all', 'also', 'am', 'an', 'and', 'any', 'are', 'as', 'at', 'be',
  'been', 'best', 'but', 'by', 'can', 'do', 'dont', 'for', 'from', 'get', 'go', 'had', 'has',
  'have', 'he', 'her', 'here', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'just', 'know', 'like', 'make', 'me', 'more', 'most', 'my', 'need', 'new', 'no', 'not',
  'now', 'of', 'on', 'one', 'only', 'or', 'our', 'out', 'over', 'own', 'she', 'so', 'some',
  'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to',
  'today', 'up', 'us', 'use', 'very', 'was', 'we', 'were', 'what', 'when', 'which', 'who',
  'why', 'will', 'with', 'you', 'your',
])

// ---------------------------------------------------------------------------
// Small numeric helpers. All of them return null rather than a stand-in.
// ---------------------------------------------------------------------------

function round(value: number, dp = 1): number {
  const factor = 10 ** dp
  return Math.round(value * factor) / factor
}

/** Mean of the non-null values, or null if there are none. Never 0-fills. */
function mean(values: Array<number | null | undefined>, dp = 1): number | null {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (present.length === 0) return null
  return round(present.reduce((sum, v) => sum + v, 0) / present.length, dp)
}

/** How many of the values were actually readable — the denominator behind every mean. */
function sampleSize(values: Array<number | null | undefined>): number {
  return values.filter((v) => typeof v === 'number' && Number.isFinite(v)).length
}

function median(values: Array<number | null | undefined>): number | null {
  const present = values
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
    .sort((a, b) => a - b)
  if (present.length === 0) return null
  const mid = Math.floor(present.length / 2)
  return present.length % 2 === 0
    ? round((present[mid - 1] + present[mid]) / 2)
    : present[mid]
}

function sum(values: Array<number | null | undefined>): number | null {
  const present = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v))
  if (present.length === 0) return null
  return present.reduce((acc, v) => acc + v, 0)
}

// ---------------------------------------------------------------------------
// Per-post derived values
// ---------------------------------------------------------------------------

/**
 * Interactions on one post = likes + comments, but ONLY when at least one of the two was
 * readable. A post with both hidden yields null and is skipped everywhere, rather than
 * counting as a zero-engagement post and dragging every average down.
 */
function interactions(post: InstagramPostRow): number | null {
  const parts = [post.like_count, post.comment_count].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v)
  )
  if (parts.length === 0) return null
  return parts.reduce((a, b) => a + b, 0)
}

/**
 * Engagement rate for one post, as a percentage of FOLLOWERS — the reach-free
 * definition, because reach is not available (see the header). Null when either side is
 * missing, and null when followers is 0 so we never divide by it.
 */
function engagementRatePct(post: InstagramPostRow, followers: number | null): number | null {
  const acts = interactions(post)
  if (acts === null || followers === null || followers <= 0) return null
  return round((acts / followers) * 100, 2)
}

/** posted_at shifted into IST, or null when the timestamp was never read. */
function istParts(postedAt: string | null): { weekday: number; hour: number; date: Date } | null {
  if (!postedAt) return null
  const parsed = new Date(postedAt)
  if (Number.isNaN(parsed.getTime())) return null
  const shifted = new Date(parsed.getTime() + IST_OFFSET_MINUTES * 60_000)
  return {
    weekday: shifted.getUTCDay(),
    hour: shifted.getUTCHours(),
    date: shifted,
  }
}

function hourBucket(hour: number): string {
  if (hour < 6) return '00:00–05:59'
  if (hour < 9) return '06:00–08:59'
  if (hour < 12) return '09:00–11:59'
  if (hour < 15) return '12:00–14:59'
  if (hour < 18) return '15:00–17:59'
  if (hour < 21) return '18:00–20:59'
  return '21:00–23:59'
}

function captionLengthBucket(caption: string | null): string | null {
  if (caption === null) return null
  const length = caption.trim().length
  if (length === 0) return 'none'
  if (length <= 80) return 'short (1–80)'
  if (length <= 300) return 'medium (81–300)'
  if (length <= 800) return 'long (301–800)'
  return 'very long (800+)'
}

/**
 * Hashtags for a post. Prefers the stored array (the sync route extracts it once), and
 * falls back to parsing the caption so a row written before that existed still counts.
 * Returns null — not [] — when there was no caption to read either way.
 */
export function hashtagsFor(post: InstagramPostRow): string[] | null {
  if (post.hashtags !== null && post.hashtags !== undefined) return post.hashtags
  if (post.caption === null) return null
  return extractHashtags(post.caption)
}

/** Lowercased, '#' stripped, de-duplicated within the one caption. */
export function extractHashtags(caption: string): string[] {
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? []
  const seen = new Set<string>()
  for (const raw of matches) seen.add(raw.slice(1).toLowerCase())
  return [...seen]
}

// ---------------------------------------------------------------------------
// Grouped aggregates
// ---------------------------------------------------------------------------

interface Grouped {
  key: string
  posts: InstagramPostRow[]
}

function groupBy(
  posts: InstagramPostRow[],
  keyOf: (post: InstagramPostRow) => string | null
): Grouped[] {
  const buckets = new Map<string, InstagramPostRow[]>()
  for (const post of posts) {
    const key = keyOf(post)
    if (key === null) continue
    const existing = buckets.get(key)
    if (existing) existing.push(post)
    else buckets.set(key, [post])
  }
  return [...buckets.entries()].map(([key, grouped]) => ({ key, posts: grouped }))
}

/**
 * The shared shape for every "how did this slice perform" table. `posts` is the slice
 * size; `engagement_sample` is how many of those had a readable like or comment count,
 * so the model can tell a confident average from a thin one.
 */
function sliceStats(posts: InstagramPostRow[], followers: number | null) {
  const acts = posts.map(interactions)
  return {
    posts: posts.length,
    engagement_sample: sampleSize(acts),
    avg_interactions: mean(acts),
    avg_likes: mean(posts.map((p) => p.like_count)),
    avg_comments: mean(posts.map((p) => p.comment_count)),
    avg_engagement_rate_pct: mean(
      posts.map((p) => engagementRatePct(p, followers)),
      2
    ),
  }
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export interface ComputeOptions {
  /** Inclusive lower bound on posted_at. Posts outside it are dropped before anything else. */
  windowStart?: Date | null
  windowEnd?: Date | null
  /** "now" for the days-since-last-post figure. Passed in so the result is testable. */
  asOf: Date
}

/**
 * Turn a connected profile and its posts into the finished figures an audit is written
 * from. Pure: no database, no network, no clock of its own.
 */
export function computeAuditFacts(
  profile: InstagramProfileRow,
  allPosts: InstagramPostRow[],
  options: ComputeOptions
): InstagramAuditFacts {
  const { windowStart = null, windowEnd = null, asOf } = options
  const followers = profile.follower_count ?? null

  // Window filter. A post with no timestamp is KEPT when no window was asked for (its
  // counters are still evidence) and DROPPED when one was, because we cannot honestly
  // say it falls inside.
  const posts = allPosts.filter((post) => {
    if (!windowStart && !windowEnd) return true
    const when = istParts(post.posted_at)
    if (!when) return false
    if (windowStart && when.date.getTime() < windowStart.getTime()) return false
    if (windowEnd && when.date.getTime() > windowEnd.getTime()) return false
    return true
  })

  const timestamped = posts
    .map((post) => ({ post, when: istParts(post.posted_at) }))
    .filter((entry): entry is { post: InstagramPostRow; when: NonNullable<ReturnType<typeof istParts>> } =>
      entry.when !== null
    )
    .sort((a, b) => a.when.date.getTime() - b.when.date.getTime())

  // --- cadence -------------------------------------------------------------
  const first = timestamped[0]?.when.date ?? null
  const last = timestamped[timestamped.length - 1]?.when.date ?? null

  let postsPerWeek: number | null = null
  if (first && last && timestamped.length >= 2) {
    const spanDays = (last.getTime() - first.getTime()) / 86_400_000
    // Under a day of span cannot support a weekly rate; saying "14/week" off two posts
    // an hour apart would be arithmetic, not information.
    postsPerWeek = spanDays >= 1 ? round((timestamped.length / spanDays) * 7, 1) : null
  }

  let longestGapDays: number | null = null
  if (timestamped.length >= 2) {
    let worst = 0
    for (let i = 1; i < timestamped.length; i += 1) {
      const gap =
        (timestamped[i].when.date.getTime() - timestamped[i - 1].when.date.getTime()) / 86_400_000
      if (gap > worst) worst = gap
    }
    longestGapDays = round(worst)
  }

  const daysSinceLastPost = last
    ? round(
        (new Date(asOf.getTime() + IST_OFFSET_MINUTES * 60_000).getTime() - last.getTime()) /
          86_400_000
      )
    : null

  // --- engagement ----------------------------------------------------------
  const allActs = posts.map(interactions)
  const rates = posts.map((post) => engagementRatePct(post, followers))

  // --- slices --------------------------------------------------------------
  const byFormat = groupBy(posts, (post) => post.media_type)
    .map((group) => ({ media_type: group.key, ...sliceStats(group.posts, followers) }))
    .sort((a, b) => b.posts - a.posts)

  const byWeekday = groupBy(posts, (post) => {
    const when = istParts(post.posted_at)
    return when ? WEEKDAYS[when.weekday] : null
  })
    .map((group) => ({ weekday: group.key, ...sliceStats(group.posts, followers) }))
    .sort(
      (a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday)
    )

  const byHourBucket = groupBy(posts, (post) => {
    const when = istParts(post.posted_at)
    return when ? hourBucket(when.hour) : null
  })
    .map((group) => ({ time_of_day_ist: group.key, ...sliceStats(group.posts, followers) }))
    .sort((a, b) => a.time_of_day_ist.localeCompare(b.time_of_day_ist))

  const byCaptionLength = groupBy(posts, (post) => captionLengthBucket(post.caption))
    .map((group) => ({ caption_length: group.key, ...sliceStats(group.posts, followers) }))
    .sort((a, b) => b.posts - a.posts)

  // --- best and worst ------------------------------------------------------
  // Ranked on interactions, so only posts with a readable counter can appear. A hidden
  // post is absent from both lists rather than pinned to the bottom of the weak one.
  const ranked = posts
    .map((post) => ({ post, acts: interactions(post) }))
    .filter((entry): entry is { post: InstagramPostRow; acts: number } => entry.acts !== null)
    .sort((a, b) => b.acts - a.acts)

  const describe = (entry: { post: InstagramPostRow; acts: number }) => ({
    shortcode: entry.post.shortcode,
    media_type: entry.post.media_type,
    posted_at_ist: istParts(entry.post.posted_at)?.date.toISOString().slice(0, 16) ?? null,
    likes: entry.post.like_count,
    comments: entry.post.comment_count,
    views: entry.post.view_count,
    interactions: entry.acts,
    engagement_rate_pct: engagementRatePct(entry.post, followers),
    hashtags: hashtagsFor(entry.post),
    // Enough caption to recognise the post and read its hook, not the whole thing —
    // the model does not need 2,000 characters times ten to spot a pattern.
    caption_excerpt: entry.post.caption ? entry.post.caption.slice(0, 240) : null,
  })

  const topPosts = ranked.slice(0, 5).map(describe)
  // Taken from the other end, and only when there are enough posts for "weakest" to
  // mean anything. With 6 posts the bottom 5 would overlap the top 5 and the model
  // would be told the same post both worked and did not.
  const weakestPosts =
    ranked.length >= 10 ? ranked.slice(-5).reverse().map(describe) : []

  // --- hashtags ------------------------------------------------------------
  const tagStats = new Map<string, InstagramPostRow[]>()
  let postsWithoutHashtags = 0
  let postsWithUnreadableCaption = 0
  for (const post of posts) {
    const tags = hashtagsFor(post)
    if (tags === null) {
      postsWithUnreadableCaption += 1
      continue
    }
    if (tags.length === 0) {
      postsWithoutHashtags += 1
      continue
    }
    for (const tag of tags) {
      const existing = tagStats.get(tag)
      if (existing) existing.push(post)
      else tagStats.set(tag, [post])
    }
  }

  const topHashtags = [...tagStats.entries()]
    .map(([tag, tagged]) => ({ tag, ...sliceStats(tagged, followers) }))
    .sort((a, b) => {
      if (b.posts !== a.posts) return b.posts - a.posts
      return (b.avg_interactions ?? 0) - (a.avg_interactions ?? 0)
    })
    .slice(0, 20)

  // --- niche signal from caption words ------------------------------------
  const wordCounts = new Map<string, number>()
  for (const post of posts) {
    if (!post.caption) continue
    const words = new Set(
      post.caption
        .toLowerCase()
        .replace(/#[\p{L}\p{N}_]+/gu, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .match(/[\p{L}][\p{L}\p{N}'-]{2,}/gu) ?? []
    )
    for (const word of words) {
      if (STOPWORDS.has(word)) continue
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1)
    }
  }
  const captionKeywords = [...wordCounts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)
    .map(([word, postsUsing]) => ({ word, posts: postsUsing }))

  // --- what we could not read ---------------------------------------------
  // Named explicitly so the model has something true to say about its own blind spots
  // instead of filling them in. Every entry here is a fact about the DATA, not the account.
  const dataGaps: string[] = []
  if (followers === null) {
    dataGaps.push(
      'Follower count was not read, so no engagement rate could be computed — only raw like and comment counts.'
    )
  }
  if (posts.length === 0) {
    dataGaps.push('No posts were available for this window.')
  } else {
    const missingTimestamps = posts.length - timestamped.length
    if (missingTimestamps > 0) {
      dataGaps.push(
        `${missingTimestamps} of ${posts.length} posts had no readable timestamp and are excluded from all timing and cadence figures.`
      )
    }
    const hiddenEngagement = posts.length - sampleSize(allActs)
    if (hiddenEngagement > 0) {
      dataGaps.push(
        `${hiddenEngagement} of ${posts.length} posts had no readable like or comment count and are excluded from every engagement average.`
      )
    }
    if (postsWithUnreadableCaption > 0) {
      dataGaps.push(
        `${postsWithUnreadableCaption} of ${posts.length} posts had no readable caption, so their hashtags and wording are unknown.`
      )
    }
    if (sampleSize(posts.map((p) => p.view_count)) === 0) {
      dataGaps.push('No view counts were available, so video reach cannot be compared to static posts.')
    }
  }
  dataGaps.push(
    'Reach, impressions, saves, shares and profile visits are not available by this collection method and are absent from every figure above.'
  )

  return {
    profile: {
      username: profile.username,
      display_name: profile.display_name,
      category: profile.category,
      biography: profile.biography,
      external_url: profile.external_url,
      is_professional_account: profile.is_professional,
      followers,
      following: profile.following_count,
      posts_on_profile_total: profile.post_count,
      last_synced_at: profile.last_synced_at,
    },
    window: {
      start: windowStart ? windowStart.toISOString().slice(0, 10) : null,
      end: windowEnd ? windowEnd.toISOString().slice(0, 10) : null,
      posts_analysed: posts.length,
      posts_with_timestamp: timestamped.length,
      earliest_post_ist: first ? first.toISOString().slice(0, 10) : null,
      latest_post_ist: last ? last.toISOString().slice(0, 10) : null,
    },
    cadence: {
      posts_per_week: postsPerWeek,
      longest_gap_days: longestGapDays,
      days_since_last_post: daysSinceLastPost,
    },
    engagement: {
      metric_definition:
        'engagement_rate_pct = (likes + comments) / followers x 100. Followers-based, NOT reach-based, because reach is unavailable.',
      engagement_sample: sampleSize(allActs),
      avg_interactions: mean(allActs),
      median_interactions: median(allActs),
      avg_likes: mean(posts.map((p) => p.like_count)),
      avg_comments: mean(posts.map((p) => p.comment_count)),
      avg_views: mean(posts.map((p) => p.view_count)),
      total_interactions: sum(allActs),
      avg_engagement_rate_pct: mean(rates, 2),
      best_engagement_rate_pct: rates.reduce<number | null>(
        (best, rate) => (rate === null ? best : best === null || rate > best ? rate : best),
        null
      ),
    },
    by_format: byFormat,
    by_weekday_ist: byWeekday,
    by_time_of_day_ist: byHourBucket,
    by_caption_length: byCaptionLength,
    top_posts: topPosts,
    weakest_posts: weakestPosts,
    hashtags: {
      distinct_used: tagStats.size,
      posts_without_hashtags: postsWithoutHashtags,
      top: topHashtags,
    },
    caption_keywords: captionKeywords,
    data_gaps: dataGaps,
  }
}
