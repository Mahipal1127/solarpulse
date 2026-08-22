import { StatCard } from '@/components/ui/primitives'
import type { PerformanceSummary } from '@/lib/services/performance'

/**
 * Renders the strict-tier performance summary. This component is only ever mounted when the caller
 * is allowed to see it — the page fetches the summary through getPerformanceSummary (CEO / HR lead
 * / self only) and passes null when the viewer is not entitled, in which case we render the locked
 * notice instead of any figures. The visibility decision lives in the service, not here; this just
 * reflects its outcome.
 */
export function PerformanceSummaryPanel({ summary }: { summary: PerformanceSummary | null }) {
  if (!summary) {
    return (
      <div className="rounded-lg border border-dashed border-border-subtle bg-surface-bg px-6 py-10 text-center">
        <p className="text-sm font-medium text-brand-slate">Performance summary is restricted</p>
        <p className="mt-1 text-xs text-text-muted">
          Only the CEO, the HR lead, and the employee themselves can view this.
        </p>
      </div>
    )
  }

  const { tasks, attendance, periodDays } = summary

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">Trailing {periodDays} days.</p>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard
          label="Task completion"
          value={tasks.completionRate === null ? '—' : `${tasks.completionRate}%`}
          hint={`${tasks.completed}/${tasks.total} tasks`}
          tone="brand"
        />
        <StatCard label="Present" value={attendance.present} hint="days" />
        <StatCard label="Half / leave" value={`${attendance.halfDay} / ${attendance.onLeave}`} hint="days" />
        <StatCard
          label="Hours worked"
          value={attendance.totalHours}
          hint={
            attendance.openShifts > 0
              ? `${attendance.openShifts} open shift${attendance.openShifts > 1 ? 's' : ''} not counted`
              : 'closed shifts'
          }
        />
      </div>

      {attendance.absent > 0 && (
        <p className="text-xs text-text-muted">
          {attendance.absent} absent day{attendance.absent > 1 ? 's' : ''} in the period.
        </p>
      )}
    </div>
  )
}
