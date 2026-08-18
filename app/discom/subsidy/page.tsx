import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, StatCard } from '@/components/ui/primitives'
import { SubsidyList } from '@/components/discom/SubsidyList'
import { getSubsidySummary } from '@/lib/discom/dashboard'
import { DISCOM_DEPARTMENT_SLUG, isDiscomLead } from '@/lib/services/discom'
import { formatCompactCurrency } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function SubsidyPage() {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)
  const seesTeam = isDiscomLead(user) || user.roleName === 'CEO'

  const summary = await getSubsidySummary(user.organization_id)

  const emptyDescription = readOnly
    ? 'The DISCOM department has not opened a subsidy case yet.'
    : seesTeam
      ? 'Open a subsidy case from a completed installation to start tracking it.'
      : 'Subsidy cases assigned to you appear here.'

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {seesTeam ? 'Subsidy' : 'My Subsidy Cases'}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            PM Surya Ghar and other schemes, sorted by longest time in current status.
          </p>
        </div>
        {!readOnly && (
          <Link
            href="/discom/subsidy/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + New subsidy case
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Open" value={summary.open} hint="Still in progress" />
        <StatCard
          label="Needs Attention"
          value={summary.stale}
          tone={summary.stale > 0 ? 'danger' : 'default'}
          hint="Stuck past 15 days"
        />
        <StatCard
          label="Disbursed"
          value={summary.disbursed}
          tone={summary.disbursed > 0 ? 'success' : 'default'}
          hint={summary.sanctioned > 0 ? `${summary.sanctioned} sanctioned, awaiting funds` : undefined}
        />
        <StatCard
          label="Disbursed Value"
          value={formatCompactCurrency(summary.disbursedValue)}
          hint="Total paid out"
        />
      </div>

      <Card>
        <SubsidyList
          cases={summary.all}
          showAssignee={seesTeam}
          emptyTitle="No subsidy cases yet"
          emptyDescription={emptyDescription}
        />
      </Card>
    </div>
  )
}
