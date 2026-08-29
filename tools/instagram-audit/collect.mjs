#!/usr/bin/env node
/**
 * Instagram audit collector — the local half of the ERP's Instagram audit.
 *
 * WHAT IT DOES
 *   1. Opens a real Chromium window on your machine.
 *   2. YOU log into Instagram yourself, by hand, in that window.
 *   3. It opens your own profile and reads the grid your browser was already given.
 *   4. It POSTs what it read to the ERP, which computes the figures and asks the AI to
 *      phrase them.
 *
 * WHY IT RUNS ON YOUR LAPTOP AND NOT ON THE SERVER
 * A logged-in browser session cannot live in a serverless function: no display, no
 * persistent profile, and a lifetime measured in seconds. That is not a policy decision,
 * it is a fact about the hosting. So collection happens where the human is, and the ERP
 * exposes one narrow endpoint for the result.
 *
 * NO PASSWORD IS STORED, ASKED FOR, OR SEEN
 * This script never prompts for Instagram credentials and has no field to put them in. You
 * type them into Instagram's own page in a normal browser window. What persists between
 * runs is Chromium's own profile directory (.profile/), exactly as it would if you used
 * that browser yourself — which is also why it is gitignored and must never be committed or
 * shared.
 *
 * HOW IT READS THE DATA — AND WHY NOT THE DOM
 * Instagram's own web app fetches its posts as JSON. This script listens to those responses
 * and reads the JSON, rather than scraping rendered HTML. Two reasons: the JSON carries
 * numbers the page rounds off ("12.4K" is 12,431 in the payload), and class names change
 * weekly while the JSON field names are comparatively stable. The parser below also walks
 * the whole payload looking for post-shaped objects instead of following a fixed path, so a
 * reshuffled response degrades into "found fewer posts" rather than crashing.
 *
 * WHAT IT CANNOT GET, AND WILL NOT GUESS
 * Reach, impressions, saves, shares and profile visits are not in these payloads — they
 * live behind the Professional dashboard's Insights panes. This tool sends null for
 * anything it could not read, and the ERP treats null as "could not be read", never as
 * zero. If a like count is hidden, it stays null and the audit says so. Nothing here
 * estimates a number.
 *
 * SCOPE: your own account, the one already connected in the ERP. The sync endpoint refuses
 * a handle nobody connected, so this cannot be pointed at someone else's profile and have
 * the result stored.
 *
 * USAGE
 *   npm install                       # once — also downloads Chromium
 *   node collect.mjs --username solarpulse --erp http://localhost:3000 --token <TOKEN>
 *
 *   Get <TOKEN> from the ERP: Marketing → AI Insights → "Run the collector". It is valid
 *   for 30 minutes and works exactly once.
 *
 * FLAGS
 *   --username <handle>   Required. The account to read. Must already be connected in the ERP.
 *   --erp <url>           ERP base URL. Default http://localhost:3000, or IG_AUDIT_ERP_URL.
 *   --token <token>       Sync token. Or set IG_AUDIT_TOKEN.
 *   --scrolls <n>         How many times to page the grid. Default 6 (~70-100 posts).
 *   --out <file>          Also write the payload to a file, so you can see what was sent.
 *   --dry-run             Collect and write the file, but do not POST. Implies --out if unset.
 *   --keep-open           Leave the browser open at the end, for when something looks wrong.
 */

import { chromium } from 'playwright'
import { writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Chromium's own profile dir. Holds the session so you log in once, not once per run. */
const PROFILE_DIR = resolve(HERE, '.profile')

/** How long to wait for you to finish logging in, in milliseconds. */
const LOGIN_TIMEOUT_MS = 10 * 60_000

/**
 * Pause between scrolls. Deliberately unhurried: this is a person's own account being read
 * at roughly the pace a person reads it, and the grid needs the time to load anyway.
 */
const SCROLL_PAUSE_MS = 2_500

/** Instagram sets this cookie only once a session is authenticated. */
const LOGGED_IN_COOKIE = 'ds_user_id'

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { scrolls: 6 }
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i]
    if (key === '--dry-run') args.dryRun = true
    else if (key === '--keep-open') args.keepOpen = true
    else if (key.startsWith('--')) {
      args[key.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = argv[++i]
    }
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

const username = String(args.username ?? '')
  .trim()
  .replace(/^@/, '')
  .toLowerCase()
const erpBase = (args.erp ?? process.env.IG_AUDIT_ERP_URL ?? 'http://localhost:3000').replace(
  /\/+$/,
  ''
)
const token = args.token ?? process.env.IG_AUDIT_TOKEN ?? ''
const scrolls = Math.max(0, Math.min(30, Number(args.scrolls) || 6))
const dryRun = Boolean(args.dryRun)
const outFile = args.out ?? (dryRun ? resolve(HERE, `${username || 'instagram'}-payload.json`) : null)

if (!username) {
  console.error('Missing --username. Example: node collect.mjs --username solarpulse')
  process.exit(1)
}
if (!dryRun && !token) {
  console.error(
    'Missing --token (or IG_AUDIT_TOKEN). Get one from the ERP: Marketing → AI Insights → "Run the collector".\n' +
      'Or pass --dry-run to collect to a file without posting.'
  )
  process.exit(1)
}

// ---------------------------------------------------------------------------
// JSON spelunking
//
// Instagram's payloads are deeply nested and the shape moves around. Rather than follow a
// path that will break, walk everything and recognise objects by their fields.
// ---------------------------------------------------------------------------

/** Depth-first walk with a depth cap, so a cyclic or absurd payload cannot hang us. */
function walk(node, visit, depth = 0, seen = new Set()) {
  if (node === null || typeof node !== 'object' || depth > 14) return
  if (seen.has(node)) return
  seen.add(node)

  visit(node)

  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit, depth + 1, seen)
  } else {
    for (const key of Object.keys(node)) walk(node[key], visit, depth + 1, seen)
  }
}

/**
 * A counter, or null.
 *
 * Instagram uses -1 as "the owner hid this count". Mapping that to null rather than 0 is the
 * single most important line in this file: the ERP reports null as "could not be read" and
 * omits it, whereas a 0 would be averaged in and would quietly invent a bad month.
 */
function count(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < 0) return null
  return Math.round(value)
}

/** First non-null among the candidates, or null. */
function firstCount(...candidates) {
  for (const candidate of candidates) {
    const value = count(candidate)
    if (value !== null) return value
  }
  return null
}

function isPostLike(node) {
  if (Array.isArray(node)) return false
  const code = node.code ?? node.shortcode
  if (typeof code !== 'string' || code.length < 4 || code.length > 40) return false
  // A post carries at least one interaction counter, in one of its several spellings. This
  // is what separates a real post object from the many stubs that also carry a code.
  return (
    'like_count' in node ||
    'comment_count' in node ||
    'edge_liked_by' in node ||
    'edge_media_preview_like' in node ||
    'edge_media_to_comment' in node ||
    'taken_at' in node ||
    'taken_at_timestamp' in node
  )
}

/**
 * media_type in Instagram's payloads is 1 = image, 2 = video, 8 = carousel, and a video whose
 * product_type is 'clips' is a Reel. Older GraphQL responses say GraphImage / GraphVideo /
 * GraphSidecar instead. Both spellings are handled; anything else yields null rather than a
 * guess, and the ERP simply reports the format as unknown.
 */
function mediaType(node) {
  const product = typeof node.product_type === 'string' ? node.product_type.toLowerCase() : ''
  if (product === 'clips') return 'reel'

  const typename = typeof node.__typename === 'string' ? node.__typename : ''
  if (typename === 'GraphSidecar' || typename === 'XDTGraphSidecar') return 'carousel'
  if (typename === 'GraphVideo' || typename === 'XDTGraphVideo') return 'video'
  if (typename === 'GraphImage' || typename === 'XDTGraphImage') return 'image'

  const raw = node.media_type
  if (raw === 8) return 'carousel'
  if (raw === 2) return 'video'
  if (raw === 1) return 'image'

  if (Array.isArray(node.carousel_media) && node.carousel_media.length > 1) return 'carousel'
  if (node.is_video === true) return 'video'
  if (node.is_video === false) return 'image'
  return null
}

function caption(node) {
  if (node.caption && typeof node.caption.text === 'string') return node.caption.text
  if (typeof node.caption === 'string') return node.caption
  const edges = node.edge_media_to_caption?.edges
  if (Array.isArray(edges) && edges.length > 0) {
    const text = edges[0]?.node?.text
    if (typeof text === 'string') return text
  }
  return null
}

function postedAt(node) {
  // taken_at is unix SECONDS in the private-API shape, taken_at_timestamp in the GraphQL one.
  const seconds = node.taken_at ?? node.taken_at_timestamp ?? node.device_timestamp
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  // Guard against a microsecond timestamp being read as seconds.
  const ms = seconds > 1e12 ? seconds / 1000 : seconds * 1000
  const date = new Date(ms)
  if (Number.isNaN(date.getTime())) return null
  const year = date.getUTCFullYear()
  if (year < 2010 || year > new Date().getUTCFullYear() + 1) return null
  return date.toISOString()
}

function carouselCount(node) {
  if (typeof node.carousel_media_count === 'number') return count(node.carousel_media_count)
  if (Array.isArray(node.carousel_media)) return node.carousel_media.length
  const edges = node.edge_sidecar_to_children?.edges
  if (Array.isArray(edges)) return edges.length
  return null
}

function toPost(node) {
  return {
    shortcode: node.code ?? node.shortcode,
    media_type: mediaType(node),
    carousel_count: carouselCount(node),
    caption: caption(node),
    like_count: firstCount(
      node.like_count,
      node.edge_liked_by?.count,
      node.edge_media_preview_like?.count
    ),
    comment_count: firstCount(node.comment_count, node.edge_media_to_comment?.count),
    view_count: firstCount(
      node.play_count,
      node.ig_play_count,
      node.view_count,
      node.video_play_count,
      node.video_view_count
    ),
    posted_at: postedAt(node),
  }
}

function isProfileLike(node, handle) {
  if (Array.isArray(node)) return false
  if (typeof node.username !== 'string') return false
  if (node.username.toLowerCase() !== handle) return false
  return (
    'follower_count' in node ||
    'edge_followed_by' in node ||
    'biography' in node ||
    'media_count' in node
  )
}

function toProfile(node) {
  return {
    display_name: typeof node.full_name === 'string' ? node.full_name : null,
    biography: typeof node.biography === 'string' ? node.biography : null,
    category:
      typeof node.category_name === 'string'
        ? node.category_name
        : typeof node.category === 'string'
          ? node.category
          : null,
    external_url: typeof node.external_url === 'string' ? node.external_url : null,
    is_professional:
      typeof node.is_professional_account === 'boolean'
        ? node.is_professional_account
        : typeof node.is_business_account === 'boolean'
          ? node.is_business_account
          : null,
    follower_count: firstCount(node.follower_count, node.edge_followed_by?.count),
    following_count: firstCount(node.following_count, node.edge_follow?.count),
    post_count: firstCount(node.media_count, node.edge_owner_to_timeline_media?.count),
  }
}

/** Merge a newly seen profile fragment over what we have, preferring non-null values. */
function mergeProfile(into, next) {
  for (const [key, value] of Object.entries(next)) {
    if (value !== null && value !== undefined) into[key] = value
  }
  return into
}

// ---------------------------------------------------------------------------
// Collection
// ---------------------------------------------------------------------------

async function waitForLogin(context) {
  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  let announced = false

  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.instagram.com')
    if (cookies.some((c) => c.name === LOGGED_IN_COOKIE && c.value)) return true

    if (!announced) {
      console.log('')
      console.log('  ┌──────────────────────────────────────────────────────────────┐')
      console.log('  │  Log into Instagram in the browser window that just opened.  │')
      console.log('  │  This tool never sees your password — you type it into       │')
      console.log('  │  Instagram’s own page. Waiting…                              │')
      console.log('  └──────────────────────────────────────────────────────────────┘')
      console.log('')
      announced = true
    }
    await new Promise((r) => setTimeout(r, 2_000))
  }
  return false
}

async function main() {
  console.log(`Instagram audit collector — @${username}`)
  console.log(`  ERP:      ${dryRun ? '(dry run, nothing will be posted)' : erpBase}`)
  console.log(`  Profile:  ${PROFILE_DIR}`)
  console.log('')

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })

  /** Every JSON body Instagram's own app received while we were watching. */
  const payloads = []

  context.on('response', async (response) => {
    const url = response.url()
    // Only Instagram's own data endpoints. Ignoring everything else keeps the pile small
    // and keeps images and telemetry out of it.
    if (!/instagram\.com\/(api\/v1|graphql)/.test(url)) return
    if (!response.ok()) return

    try {
      const type = response.headers()['content-type'] ?? ''
      if (!type.includes('json')) return
      payloads.push(await response.json())
    } catch {
      // A response body that is gone or not really JSON is not worth a word — we simply
      // collected one fewer payload, which shows up as fewer posts at the end.
    }
  })

  const page = context.pages()[0] ?? (await context.newPage())

  try {
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' })

    if (!(await waitForLogin(context))) {
      console.error('Timed out waiting for login. Nothing was collected.')
      await context.close()
      process.exit(1)
    }
    console.log('Logged in. Opening the profile…')

    // Clear anything gathered during login — it is feed and suggestion data, not this
    // profile's grid, and would only add noise for the walker to reject.
    payloads.length = 0

    await page.goto(`https://www.instagram.com/${username}/`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(4_000)

    let seenPosts = 0
    for (let i = 0; i < scrolls; i += 1) {
      await page.mouse.wheel(0, 4_000)
      await page.waitForTimeout(SCROLL_PAUSE_MS)

      // Stop early once the grid stops yielding anything new — there is no point paging
      // past the end of a small account.
      const found = new Set()
      for (const payload of payloads) {
        walk(payload, (node) => {
          if (isPostLike(node)) found.add(node.code ?? node.shortcode)
        })
      }
      if (found.size === seenPosts && i > 0) {
        console.log(`  no new posts after scroll ${i + 1}, stopping early`)
        break
      }
      seenPosts = found.size
      console.log(`  scroll ${i + 1}/${scrolls} — ${seenPosts} posts seen`)
    }

    // --- assemble -------------------------------------------------------
    const postsByCode = new Map()
    let profile = {}
    let sawProfile = false

    for (const payload of payloads) {
      walk(payload, (node) => {
        if (isProfileLike(node, username)) {
          profile = mergeProfile(profile, toProfile(node))
          sawProfile = true
        }
        if (isPostLike(node)) {
          const post = toPost(node)
          const existing = postsByCode.get(post.shortcode)
          // Later payloads can be richer than earlier ones for the same post (a grid tile
          // has no caption; the detail payload does). Keep whichever field is present.
          postsByCode.set(post.shortcode, existing ? mergeProfile({ ...existing }, post) : post)
        }
      })
    }

    const posts = [...postsByCode.values()]

    // Honest self-report. The ERP turns this into sync_status = 'partial' and shows it, so a
    // thin collection is visible rather than silently treated as the whole account.
    const notes = []
    if (!sawProfile) notes.push('Profile header was not captured, so follower counts are missing.')
    if (posts.length === 0) notes.push('No posts were captured.')
    const hiddenLikes = posts.filter((p) => p.like_count === null).length
    if (hiddenLikes > 0) notes.push(`${hiddenLikes} posts had no readable like count.`)
    const noTimestamp = posts.filter((p) => p.posted_at === null).length
    if (noTimestamp > 0) notes.push(`${noTimestamp} posts had no readable timestamp.`)

    const payload = {
      username,
      profile,
      posts: posts.slice(0, 500),
      partial: notes.length > 0,
      notes: notes.length > 0 ? notes.join(' ') : null,
    }

    console.log('')
    console.log(`Collected ${posts.length} posts.`)
    if (profile.follower_count != null) console.log(`  followers: ${profile.follower_count}`)
    for (const note of notes) console.log(`  note: ${note}`)

    if (outFile) {
      await writeFile(outFile, JSON.stringify(payload, null, 2), 'utf8')
      console.log(`  written to ${outFile}`)
    }

    if (dryRun) {
      console.log('')
      console.log('Dry run — nothing was posted to the ERP.')
    } else if (posts.length === 0 && !sawProfile) {
      console.error('')
      console.error('Nothing usable was collected, so nothing was posted. Try --keep-open to look.')
      process.exitCode = 1
    } else {
      console.log('')
      console.log(`Posting to ${erpBase}/api/instagram/sync …`)
      const response = await fetch(`${erpBase}/api/instagram/sync`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        console.error(`  failed (${response.status}): ${body.error ?? 'unknown error'}`)
        process.exitCode = 1
      } else {
        console.log(`  stored ${body.postsWritten} posts for @${body.username}.`)
        if (body.postsRejected) console.log(`  ${body.postsRejected} rows were unusable and dropped.`)
        console.log('')
        console.log('Done. Generate the audit in the ERP: Marketing → AI Insights.')
      }
    }
  } finally {
    if (args.keepOpen) {
      console.log('')
      console.log('--keep-open set. Close the browser window yourself when finished.')
    } else {
      await context.close()
    }
  }
}

main().catch((err) => {
  console.error('Collector failed:', err?.message ?? err)
  process.exit(1)
})
