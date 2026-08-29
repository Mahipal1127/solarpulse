import 'server-only'

import { loadAIConfig, recordUsage, requireUsableAI, AIUnavailableError } from '@/lib/ai/config'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  ScriptFacts,
  PlanFacts,
  GeneratedScript,
  PlanItem,
  ScriptGenerationResult,
  PlanGenerationResult,
} from '@/lib/marketing/creative-types'

/**
 * The AI writer for Marketing's Creative surface: Instagram scripts, and week/month content
 * calendars.
 *
 * HOW THIS OBEYS THE AI RULE IN A CREATIVE SETTING.
 * A script is not a figure, so this is not "phrase these numbers". But the rule still holds in
 * the form that matters: the model is GROUNDED in material it is given — the brand profile, the
 * distilled findings of the org's own Instagram audit, and the team's own reference scripts —
 * and it is told, explicitly and repeatedly, never to state a metric it cannot see and never to
 * invent facts about the business. The exact context it was given is stored in the caller's
 * `facts` column, so a reader can always see what the script was written from. Creativity is
 * invited in the wording, the hook and the structure; fabrication about reach, results, or the
 * business is not.
 *
 * THE "TRAINING" LOOP, HONESTLY. There is no fine-tuning. An approved script becomes a
 * reference example (source 'ai_approved' in marketing_script_library), and future calls are
 * shown those examples as "write in this voice and structure". The model learns the house style
 * by being shown it every time, which is what actually moves output quality here.
 *
 * AI OFF IS NOT AN ERROR. Like every other AI feature, an unusable config returns a null result
 * with a reason; the caller stores a placeholder row the team can fill in by hand. The feature
 * degrades to "a place to write and keep scripts", never to a 500.
 */

const SCRIPT_SYSTEM = `You are a senior short-form social copywriter for an Indian rooftop and commercial solar EPC company. You write Instagram scripts that are built to be watched to the end, saved, and shared — genuinely engaging, SEO-aware, and true to the brand.

You are given a JSON object with the brief, the brand profile, distilled findings from the company's OWN Instagram audit, and the company's own reference scripts. Rules:

GROUNDING
- Use the brand profile as the truth about who this company is, what it sells, and how it speaks. Match the tone_voice exactly if given.
- "own_examples" are the company's own past scripts — mirror their voice, pacing and hook style. "approved_examples" are scripts the team already approved; treat them as the house style to continue. "contrast_examples" are competitors and inspirations — learn structure and energy from them, but never copy lines and never imitate a competitor's brand.
- "audit" holds findings from THIS account. Lean into the formats, posting times, hashtags and themes that the audit shows are working. Use "caption_keywords" and "top_hashtags" as real signals of the niche.

HONESTY — THIS IS NOT NEGOTIABLE
- Never state a performance number the audit does not contain. Reach, impressions, saves, shares, profile visits and follower growth are NOT available — never claim, imply or promise them. Read "data_gaps" and respect every line.
- Never invent facts about the business: no fake discounts, no fake certifications, no invented customer counts, no made-up subsidy figures. If the brief needs a fact you were not given, write a natural placeholder in [square brackets] for the team to fill.
- Do not fabricate testimonials or name real people.

CRAFT
- Open with a hook that stops the scroll in the first two seconds. It must be specific, not "Did you know?".
- Keep a reel script to roughly 30–45 seconds of spoken content. Write it as spoken lines with light direction, not an essay.
- Weave the SEO keywords in naturally — in the hook, the caption and the hashtags — never as a keyword dump.
- Give a caption that earns the save (a clear takeaway or a reason to act) and a call to action that fits a solar buyer's journey.

OUTPUT — return ONLY a single JSON object, no prose around it, with exactly these keys:
{
  "title": "a short internal name for this script",
  "hook": "the first spoken line / on-screen hook",
  "script_body": "the full spoken script with light direction, newline-separated",
  "caption": "the post caption",
  "hashtags": ["hashtag", "without", "the", "#"],
  "seo_keywords": ["the", "keywords", "you", "targeted"]
}
Return valid JSON only. If a field genuinely does not apply, use null (or [] for the arrays).`

const PLAN_SYSTEM = `You are a social media strategist for an Indian rooftop and commercial solar EPC company. You plan a content calendar that builds an audience and drives solar enquiries.

You are given a JSON object with the date range, the brand profile, distilled findings from the company's OWN Instagram audit, and titles already on the calendar. Rules:
- Plan one content idea per date in "dates" — no more, no fewer. Vary the format and the theme across the range so it is not repetitive.
- Ground every idea in the brand: what they sell, their audience, their offers, their voice.
- Lean into what the audit shows works — its best formats, best posting times, and recurring themes. Do NOT repeat any title in "existing_titles".
- Never promise or cite a metric the audit does not contain (no reach/impressions/saves/etc.), and never invent a business fact; use [square brackets] for anything the team must fill in.
- Mix education, proof/process, offers and light/relatable content — a feed that is all sales does not grow.

OUTPUT — return ONLY a single JSON object, no prose around it:
{
  "items": [
    {
      "scheduled_date": "YYYY-MM-DD (one of the given dates)",
      "content_type": "reel | post | story",
      "title": "a short specific title",
      "hook": "the opening hook or angle",
      "caption_idea": "one line on the caption / message",
      "rationale": "one line on why this, tied to the brand or audit"
    }
  ]
}
Return valid JSON only, one item per date given.`

// ---------------------------------------------------------------------------
// Script generation
// ---------------------------------------------------------------------------

export async function generateScript(
  user: SessionUser,
  facts: ScriptFacts
): Promise<ScriptGenerationResult> {
  const config = await loadAIConfig(user.organization_id)

  let adapter
  try {
    adapter = await requireUsableAI(config)
  } catch (err) {
    return {
      facts,
      script: null,
      unavailableReason:
        err instanceof AIUnavailableError
          ? err.message
          : 'AI is unavailable. You can write and save the script yourself.',
    }
  }

  try {
    const result = await adapter.complete({
      system: SCRIPT_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      maxTokens: 2200,
    })

    await recordUsage({
      config,
      userId: user.id,
      usage: result.usage,
      promptSummary: `Instagram ${facts.content_type} script: ${facts.brief.slice(0, 120)}`,
    })

    if (result.refused || !result.text) {
      return { facts, script: null, unavailableReason: 'The model declined to write a script.' }
    }

    return { facts, script: parseScript(result.text), unavailableReason: null }
  } catch (err) {
    console.error('[ai] script generation failed', err)
    return {
      facts,
      script: null,
      unavailableReason: 'Could not reach the AI provider. You can write the script yourself.',
    }
  }
}

// ---------------------------------------------------------------------------
// Calendar planning
// ---------------------------------------------------------------------------

export async function generatePlan(
  user: SessionUser,
  facts: PlanFacts
): Promise<PlanGenerationResult> {
  const config = await loadAIConfig(user.organization_id)

  let adapter
  try {
    adapter = await requireUsableAI(config)
  } catch (err) {
    return {
      facts,
      items: [],
      unavailableReason:
        err instanceof AIUnavailableError
          ? err.message
          : 'AI is unavailable. You can add calendar items yourself.',
    }
  }

  try {
    // A month can be 31 ideas with hooks and rationale; give the output room.
    const maxTokens = facts.range_kind === 'month' ? 4000 : 1800
    const result = await adapter.complete({
      system: PLAN_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      maxTokens,
    })

    await recordUsage({
      config,
      userId: user.id,
      usage: result.usage,
      promptSummary: `Content ${facts.range_kind} plan ${facts.start_date} to ${facts.end_date}`,
    })

    if (result.refused || !result.text) {
      return { facts, items: [], unavailableReason: 'The model declined to write a plan.' }
    }

    return { facts, items: parsePlanItems(result.text, facts), unavailableReason: null }
  } catch (err) {
    console.error('[ai] content plan generation failed', err)
    return {
      facts,
      items: [],
      unavailableReason: 'Could not reach the AI provider. You can add calendar items yourself.',
    }
  }
}

// ---------------------------------------------------------------------------
// Parsing — models wrap JSON in prose or fences despite instructions
// ---------------------------------------------------------------------------

/**
 * Pull the first JSON object out of a model response.
 *
 * Models drift: a ```json fence, a "Here's your script:" preamble, a trailing note. Rather than
 * trust `JSON.parse` on the whole string, find the outermost braces and parse that. Returns null
 * on anything unparseable, and every caller treats null as "AI produced nothing usable" — never
 * as a crash and never as a partial guess.
 */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1] : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch {
    return null
  }
}

/** A string, trimmed, or null — never the string "null" or an empty string. */
function str(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

/** An array of clean strings (hashtags with any leading # stripped), or null. */
function stringArray(value: unknown, stripHash = false): string[] | null {
  if (!Array.isArray(value)) return null
  const cleaned = value
    .map((entry) => str(entry))
    .filter((entry): entry is string => entry !== null)
    .map((entry) => (stripHash ? entry.replace(/^#+/, '').trim() : entry))
    .filter((entry) => entry.length > 0)
  return cleaned.length > 0 ? cleaned : null
}

function parseScript(text: string): GeneratedScript | null {
  const parsed = extractJson(text)
  if (parsed === null || typeof parsed !== 'object') {
    // Not JSON at all — keep the prose as the body rather than throwing it away. A usable
    // script the team can clean up beats a discarded generation.
    const body = str(text)
    return body ? { title: null, hook: null, script_body: body, caption: null, hashtags: null, seo_keywords: null } : null
  }
  const obj = parsed as Record<string, unknown>
  return {
    title: str(obj.title),
    hook: str(obj.hook),
    script_body: str(obj.script_body),
    caption: str(obj.caption),
    hashtags: stringArray(obj.hashtags, true),
    seo_keywords: stringArray(obj.seo_keywords),
  }
}

/**
 * Parse plan items and reconcile them against the dates actually asked for.
 *
 * The model is told one item per date, but is not trusted to obey: an item whose scheduled_date
 * is not in the requested range is dropped (it cannot be committed to a calendar day we did not
 * ask about), and day_offset is recomputed here from the range start rather than taken from the
 * model, so the committed calendar dates are always correct regardless of what the model said.
 */
function parsePlanItems(text: string, facts: PlanFacts): PlanItem[] {
  const parsed = extractJson(text)
  if (parsed === null || typeof parsed !== 'object') return []
  const rawItems = (parsed as Record<string, unknown>).items
  if (!Array.isArray(rawItems)) return []

  const allowed = new Set(facts.dates)
  const start = new Date(`${facts.start_date}T00:00:00Z`).getTime()

  const items: PlanItem[] = []
  for (const raw of rawItems) {
    if (raw === null || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>
    const scheduled = str(obj.scheduled_date)
    if (!scheduled || !allowed.has(scheduled)) continue

    const rawType = str(obj.content_type)?.toLowerCase()
    const content_type: PlanItem['content_type'] =
      rawType === 'post' ? 'post' : rawType === 'story' ? 'story' : 'reel'

    const dayOffset = Math.round(
      (new Date(`${scheduled}T00:00:00Z`).getTime() - start) / 86_400_000
    )

    items.push({
      day_offset: dayOffset,
      scheduled_date: scheduled,
      content_type,
      title: str(obj.title) ?? 'Untitled idea',
      hook: str(obj.hook),
      caption_idea: str(obj.caption_idea),
      rationale: str(obj.rationale),
    })
  }

  return items.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
}
