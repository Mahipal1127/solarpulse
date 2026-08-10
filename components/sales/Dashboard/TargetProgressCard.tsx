import { Card, CardHeader, ProgressBar, EmptyState } from '@/components/ui/primitives'
import { formatCurrency, formatDate } from '@/lib/format'
import type { SalesTarget } from '@/lib/types'

export interface TargetProgress {
  target: SalesTarget
  /** Sum of closures attributed to this employee inside the target period. */
  achievedAmount: number
  achievedDeals: number
}

/**
 * Read-only by construction. An executive has select-only RLS on their own
 * sales_targets row — no insert or update policy exists for them — so there is
 * nothing to render but the number and how close they are to it. Editing lives
 * on the Reports page, behind the manager/CEO check.
 */
export function TargetProgressCard({
  progress,
  ownerLabel,
}: {
  progress: TargetProgress | null
  /** 'My target' on the personal dashboard, a name in the team view. */
  ownerLabel?: string
}) {
  if (!progress) {
    return (
      <Card>
        <CardHeader title={ownerLabel ?? 'My Target'} />
        <EmptyState
          title="No target set for this period"
          description="Your Sales Manager or the CEO sets targets. Until one exists there is nothing to measure against."
        />
      </Card>
    )
  }

  const { target, achievedAmount, achievedDeals } = progress
  const amountPct = target.target_amount > 0 ? (achievedAmount / target.target_amount) * 100 : 0
  const remaining = Math.max(0, target.target_amount - achievedAmount)
  const met = achievedAmount >= target.target_amount

  return (
    <Card>
      <CardHeader
        title={ownerLabel ?? 'My Target'}
        subtitle={`${formatDate(target.period_start)} — ${formatDate(target.period_end)}`}
      />
      <div className="space-y-4 px-5 py-4">
        <div>
          <div className="flex items-end justify-between gap-3">
            <div>
              <p className="text-2xl font-semibold text-brand-slate">
                {formatCurrency(achievedAmount)}
              </p>
              <p className="mt-0.5 text-xs text-text-muted">
                of {formatCurrency(target.target_amount)}
              </p>
            </div>
            <p
              className={`text-sm font-semibold ${met ? 'text-status-success' : 'text-text-muted'}`}
            >
              {Math.round(amountPct)}%
            </p>
          </div>
          <div className="mt-2">
            <ProgressBar value={amountPct} />
          </div>
          <p className="mt-1.5 text-xs text-text-muted">
            {met
              ? 'Target met for this period.'
              : `${formatCurrency(remaining)} to go.`}
          </p>
        </div>

        {target.target_deals !== null && (
          <div className="border-t border-border-subtle pt-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-text-muted">Deals closed</span>
              <span className="font-semibold text-brand-slate">
                {achievedDeals} / {target.target_deals}
              </span>
            </div>
          </div>
        )}
      </div>
    </Card>
  )
}
