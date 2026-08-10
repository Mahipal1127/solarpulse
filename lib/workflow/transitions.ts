/**
 * Status-transition checking, shared by every module that has a status flow.
 *
 * Lives here rather than in one module's constants file because Technical is the
 * second module to need it, and having Technical import from
 * lib/distribution/constants would couple two unrelated departments over a
 * four-line generic helper. Distribution re-exports it so its own call sites are
 * unchanged.
 *
 * No 'server-only': the transition tables that feed this decide which buttons a
 * status tracker offers, so both are imported by client components. Nothing here
 * is a permission check — the service layer and RLS do that.
 */

/**
 * True when `to` is reachable from `from`.
 *
 * A status is never reachable from itself: a no-op transition is a caller bug, not
 * a legal move, and letting it through would write an audit row saying something
 * changed when nothing did.
 */
export function canTransition<T extends string>(
  table: Record<T, T[]>,
  from: T,
  to: T
): boolean {
  if (from === to) return false
  return (table[from] ?? []).includes(to)
}
