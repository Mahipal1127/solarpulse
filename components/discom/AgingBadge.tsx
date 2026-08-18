import { Clock, AlertTriangle } from 'lucide-react'
import { formatDaysInStatus, DISCOM_STALENESS_THRESHOLD_DAYS } from '@/lib/format'

/**
 * How long a case has sat in its current status — the number this whole module is
 * built around. A stale case (past the threshold, and still live) turns danger-red
 * with a warning glyph so it reads at a glance on a list of dozens; anything younger
 * is a quiet muted clock. Terminal cases pass isStale=false, so a finished case never
 * shows red however old its last move was.
 */
export function AgingBadge({
  days,
  isStale,
}: {
  days: number
  isStale: boolean
}) {
  if (isStale) {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-status-danger/10 px-2 py-0.5 text-xs font-semibold text-status-danger ring-1 ring-inset ring-status-danger/20"
        title={`In this status ${formatDaysInStatus(days)} — flagged after ${DISCOM_STALENESS_THRESHOLD_DAYS} days`}
      >
        <AlertTriangle className="h-3 w-3" />
        {formatDaysInStatus(days)}
      </span>
    )
  }

  return (
    <span
      className="inline-flex items-center gap-1 text-xs text-text-muted"
      title="Time in current status"
    >
      <Clock className="h-3 w-3" />
      {formatDaysInStatus(days)}
    </span>
  )
}
