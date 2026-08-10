import 'server-only'

import { ServiceError } from '@/lib/services/tasks'
import { canTransition } from '@/lib/workflow/transitions'

/**
 * Rejects a status change that is not an edge in the entity's transition table.
 *
 * Server-side only, unlike canTransition() which client status trackers import to
 * decide which buttons to offer: this one throws a ServiceError carrying an HTTP
 * status, so it belongs with the service layer rather than the shared table.
 *
 * The message names both ends so a caller learns what went wrong rather than just
 * that something did — the requirement that an illegal transition fails loudly with
 * a 400 rather than silently.
 *
 * `labels` is passed in rather than read from lib/format.ts on purpose: API error
 * strings should not change because someone reworded a badge in the UI.
 */
export function assertTransition<T extends string>(
  table: Record<T, T[]>,
  from: T,
  to: T,
  labels: Record<T, string>
): void {
  if (from === to) return
  if (!canTransition(table, from, to)) {
    const allowed = (table[from] ?? []).map((s) => labels[s]).join(', ')
    throw new ServiceError(
      allowed
        ? `Cannot move from ${labels[from]} to ${labels[to]}. Allowed next: ${allowed}`
        : `${labels[from]} is a final state and cannot be changed`,
      400
    )
  }
}
