import { Card, CardHeader, StatCard, ProgressBar } from '@/components/ui/primitives'
import type { PmSuryaGharAnalysis } from '@/lib/store/dashboard'

/**
 * PM Surya Ghar Analysis (Basic) — a pure read-only aggregation of O&M's installations and
 * DISCOM's subsidy_cases. Owns no data. Subsidy "completed" is the 'disbursed' terminal state
 * and "pending" is anything still in flight (not disbursed, not rejected), matching the real
 * subsidy_status enum which has no literal 'pending'/'completed' value.
 */
export function PMSuryaGharAnalysis({ analysis }: { analysis: PmSuryaGharAnalysis }) {
  const { subsidyTotal, subsidyCompleted, subsidyPending } = analysis
  const completedPct = subsidyTotal > 0 ? Math.round((subsidyCompleted / subsidyTotal) * 100) : 0

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Total installations"
          value={analysis.totalInstallations}
          tone="brand"
        />
        <StatCard
          label="Installed capacity"
          value={`${analysis.installedCapacityKw.toFixed(2)} kW`}
        />
        <StatCard label="Subsidy cases" value={subsidyTotal} />
        <StatCard
          label="Pending subsidy"
          value={subsidyPending}
          tone={subsidyPending > 0 ? 'warning' : 'default'}
        />
      </div>

      <Card>
        <CardHeader
          title="Subsidy progress"
          subtitle="Completed = disbursed; pending = still in process (not disbursed or rejected)."
        />
        <div className="space-y-4 px-5 py-4">
          <div className="flex items-center justify-between text-sm">
            <span className="text-text-muted">Disbursed</span>
            <span className="font-semibold text-brand-slate">
              {subsidyCompleted} of {subsidyTotal}
            </span>
          </div>
          <ProgressBar value={completedPct} />
          <p className="text-xs text-text-muted">{completedPct}% of subsidy cases disbursed.</p>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="District-wise summary"
          subtitle="Optional in the blueprint — not available yet."
        />
        <div className="px-5 py-4">
          <p className="rounded-lg bg-surface-bg px-3 py-3 text-xs text-text-muted">
            A district breakdown needs a structured district/area field on customers or
            installations. Those records currently store only a free-text address, so there is
            nothing reliable to group by. This will populate once a structured location field is
            added upstream — Store does not own that data, so it is left as a follow-up rather
            than guessed from free text.
          </p>
        </div>
      </Card>
    </div>
  )
}
