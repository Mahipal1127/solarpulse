import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, StatCard } from '@/components/ui/primitives'
import { NetMeteringList } from '@/components/discom/NetMeteringList'
import { getNetMeteringSummary } from '@/lib/discom/dashboard'
import { DISCOM_DEPARTMENT_SLUG, isDiscomLead } from '@/lib/services/discom'

export const dynamic = 'force-dynamic'

export default async function NetMeteringPage() {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)
  const seesTeam = isDiscomLead(user) || user.roleName === 'CEO'

  const summary = await getNetMeteringSummary(user.organization_id)

  const emptyDescription = readOnly
    ? 'The DISCOM department has not opened a net metering application yet.'
    : seesTeam
      ? 'Open an application from a completed installation to start tracking it.'
      : 'Net metering cases assigned to you appear here.'

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {seesTeam ? 'Net Metering' : 'My Net Metering Cases'}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Sorted by longest time in current status — the cases stuck the longest sit at the top.
          </p>
        </div>
        {!readOnly && (
          <Link
            href="/discom/net-metering/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + New application
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
          label="Approved"
          value={summary.approved}
          tone={summary.approved > 0 ? 'success' : 'default'}
        />
        <StatCard label="Rejected" value={summary.rejected} />
      </div>

      <Card>
        <NetMeteringList
          applications={summary.all}
          showAssignee={seesTeam}
          emptyTitle="No net metering applications yet"
          emptyDescription={emptyDescription}
        />
      </Card>
    </div>
  )
}
