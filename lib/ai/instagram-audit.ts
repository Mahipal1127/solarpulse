import 'server-only'

import { loadAIConfig, recordUsage, requireUsableAI, AIUnavailableError } from '@/lib/ai/config'
import type { SessionUser } from '@/lib/auth/guards'
import type { InstagramAuditFacts } from '@/lib/instagram/types'

/**
 * The AI narrative for an Instagram account audit.
 *
 * Every figure the narrative can contain is computed in lib/instagram/metrics.ts from
 * posts this system stored. The AI is handed the finished numbers and asked only to
 * phrase them and draw conclusions from them — it is never the source of a figure, so it
 * cannot invent one. Same rule as lib/ai/summary.ts and lib/ai/employee-report.ts.
 *
 * IT MATTERS PARTICULARLY HERE, for a reason the other two do not have. Social-media
 * audits are the single most benchmark-infested genre a language model has been trained
 * on: "industry average engagement is 1.2%", "Reels get 3x the reach", "post at 6pm for
 * maximum impact". None of that is in our data, all of it sounds authoritative, and a
 * marketing team would act on it. The prompt below therefore bans outside numbers
 * explicitly and repeatedly, and bans the five metrics we cannot see by name — reach,
 * impressions, saves, shares, profile visits — because a model that has read a thousand
 * audits will reach for them by habit.
 *
 * NULL MEANS "COULD NOT BE READ", NOT ZERO. Instagram hides like counts on some posts and
 * view counts exist only on video. facts.data_gaps names each gap in plain words, and the
 * prompt requires the model to state them rather than fill them in.
 *
 * AI OFF IS NOT AN ERROR. An unusable config returns a null narrative plus a reason. The
 * facts are still worth storing and showing — the numbers are the audit; the prose is a
 * reading of it.
 */

export interface InstagramAuditDraft {
  narrative: string | null
  unavailableReason: string | null
}

const AUDIT_SYSTEM = `You audit the Instagram presence of an Indian rooftop and commercial solar EPC company. Your reader is that company's marketing team and its CEO. They will act on what you write, so being useful and being honest are the same requirement.

You will be given a JSON object of figures computed from that account's own posts. Rules, in order of importance:

- Use ONLY what is in the JSON. Never introduce a number, date, competitor, benchmark or industry average that is not there. You have no knowledge of this account beyond this JSON.
- NEVER cite an external or remembered benchmark. Do not write "the industry average is", "typical accounts see", "best practice is N posts per week", or any figure you did not read in the JSON. If you want to say a number is low or high, say what it is low or high RELATIVE TO — another slice of this same account's data.
- The following are NOT AVAILABLE and must never appear in your output, as a figure, an estimate or an inference: reach, impressions, saves, shares, profile visits, follower growth over time, audience demographics, story performance. Do not say they are low, high, or unknown-but-probably. Simply do not discuss them.
- "engagement_rate_pct" is (likes + comments) / followers, not reach-based. Describe it that way if you name it. Never call it "reach rate".
- A null or missing field means that data COULD NOT BE READ, not that the value is zero. Omit it. Never write "no engagement", "zero comments" or "no activity" for a field that is absent.
- Respect the sample sizes. Every slice carries "posts" and "engagement_sample". A slice with 1 or 2 posts is an anecdote, not a pattern — you may mention it as a single example, but do not call it a trend or recommend a strategy from it. Say how many posts a claim rests on when it rests on few.
- Read "data_gaps" and state the ones that limit your conclusions, in your own words, in the Reading the data section. Do not pad it out; do not apologise; just be clear about what you could not see.

Structure your output with exactly these five markdown headings, in this order, and nothing before or after them:

## Niche and positioning
What this account is about, inferred from the bio, the category, the recurring caption keywords and the hashtags. Name the actual words and tags you inferred it from. If the signals conflict or are too thin to call, say so instead of picking one.

## What is working
The formats, timings, caption lengths and hashtags with the strongest measured engagement in this data, each with its figure and its post count. Point at specific posts from top_posts by their shortcode and what they have in common.

## What is not working
The weakest measured slices, with the same discipline. Cadence problems (long gaps, days since last post) belong here if the figures show them. If nothing in the data is clearly weak, say that rather than inventing a flaw.

## Recommendations
Between three and six concrete actions, each one traceable to a figure above. Format them as a numbered list. Every recommendation must name the evidence it comes from. No generic social-media advice — if you cannot tie it to this account's numbers, leave it out.

## Reading the data
Two to four sentences: what this audit is based on (post count, window), and what the gaps mean for how much weight to put on it.

Write plain, direct British-influenced Indian business English. No emoji, no exclamation marks, no marketing voice, no "leverage" or "synergy". Address the team as "you".`

/**
 * Ask the model to phrase an already-computed set of facts.
 *
 * Takes the facts rather than computing them, so the caller can store the exact object
 * that was sent. That is what makes instagram_audits.facts an audit trail rather than a
 * second, possibly divergent, computation.
 */
export async function buildInstagramAuditNarrative(
  user: SessionUser,
  facts: InstagramAuditFacts
): Promise<InstagramAuditDraft> {
  let adapter
  const config = await loadAIConfig(user.organization_id)
  try {
    adapter = await requireUsableAI(config)
  } catch (err) {
    return {
      narrative: null,
      unavailableReason:
        err instanceof AIUnavailableError
          ? err.message
          : 'AI is unavailable, so no written audit was produced. The measured figures below are complete.',
    }
  }

  try {
    const result = await adapter.complete({
      system: AUDIT_SYSTEM,
      messages: [{ role: 'user', content: JSON.stringify(facts, null, 2) }],
      // Five sections with evidence cited in each runs longer than a report draft.
      maxTokens: 2600,
    })

    await recordUsage({
      config,
      userId: user.id,
      usage: result.usage,
      promptSummary: `Instagram audit for @${facts.profile.username} (${facts.window.posts_analysed} posts)`,
    })

    if (result.refused || !result.text) {
      return {
        narrative: null,
        unavailableReason: 'The model declined to write this audit. The measured figures below are complete.',
      }
    }

    return { narrative: result.text, unavailableReason: null }
  } catch (err) {
    console.error('[ai] instagram audit failed', err)
    return {
      narrative: null,
      unavailableReason:
        'Could not reach the AI provider. The measured figures below are complete and the audit can be generated again later.',
    }
  }
}
