/**
 * Credits — the unit the assistant's usage is measured in.
 *
 * Pure data and pure functions, no server-only guard: the settings form and the
 * chat surface both need the wording, and two copies of a user-facing sentence
 * drift the moment one is edited.
 *
 * WHY CREDITS AND NOT TOKENS
 * Tokens are the provider's billing unit, and the number is meaningless without
 * knowing which model produced it — 10,000 tokens on Haiku and on Opus are not
 * comparable amounts of anything a CEO cares about. Credits are this product's own
 * unit, so that is what the UI says and what the columns are called (migration
 * 0011).
 *
 * ONE CREDIT IS ONE TOKEN, TODAY
 * CREDITS_PER_TOKEN is 1 deliberately. The rename carried no arithmetic with it, so
 * every limit already stored kept its meaning — a ratio applied during the rename
 * would have silently tightened or loosened every existing cap with nothing on
 * screen to explain it.
 *
 * If a coarser unit is wanted later this is the one place to change, plus a data
 * migration to rescale the stored rows. Keep it an integer ratio: fractional
 * credits reintroduce exactly the "what does 0.7 of a credit mean" problem that
 * moving off tokens was meant to solve.
 */

export const CREDITS_PER_TOKEN = 1

/** Provider tokens → credits. Rounded up: a partial credit still costs one. */
export function tokensToCredits(tokens: number): number {
  return Math.ceil(tokens * CREDITS_PER_TOKEN)
}

/** Indian digit grouping, matching every other number in this app. */
export function formatCredits(credits: number): string {
  return credits.toLocaleString('en-IN')
}

/**
 * What the CEO is told when the day's credits are gone.
 *
 * Written as a plain sentence rather than an error string, because it is not an
 * error — the system did exactly what it was configured to do. It states what
 * happened, when it resolves itself, and who can change it, in that order. No
 * apology and no exclamation: the assistant stopping at a limit the CEO set is
 * ordinary behaviour.
 *
 * "after midnight" rather than a countdown: the reset is a date boundary in the
 * server's zone, and a live countdown would need the clock, which is how hydration
 * mismatches get introduced for no benefit.
 */
export function creditLimitReachedMessage(used: number, limit: number): string {
  return (
    `Today's AI credit limit has been reached — ${formatCredits(used)} of ` +
    `${formatCredits(limit)} credits used. The assistant will start working again ` +
    `after midnight, or you can raise the daily limit in AI Settings.`
  )
}
