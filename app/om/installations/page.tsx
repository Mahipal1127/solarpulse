import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, StatCard } from '@/components/ui/primitives'
import { InstallationList } from '@/components/om/InstallationList/InstallationList'
import { getInstallationSummary } from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG, isOMLead } from '@/lib/services/operations'

export const dynamic = 'force-dynamic'

export default async function InstallationsPage() {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, OM_DEPARTMENT_SLUG)

  // A lead or the CEO sees whose site is whose; a technician only ever gets their
  // own rows back from RLS, so the team-lead column would be one repeated name.
  const seesTeam = isOMLead(user) || user.roleName === 'CEO'

  const summary = await getInstallationSummary(user.organization_id)

  const emptyDescription = readOnly
    ? 'The Operations & Maintenance department has not logged an installation yet.'
    : seesTeam
      ? 'Convert a closed deal, or add an installation to start tracking it on site.'
      : 'Installations you are on the team for appear here.'

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {seesTeam ? 'Installations' : 'My Installations'}
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            <span>{summary.total} total</span>
            <span>·</span>
            <span>{summary.open} in progress or scheduled</span>
          </div>
        </div>
        {!readOnly && (
          <Link
            href="/om/installations/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + New installation
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="In Progress" value={summary.inProgress} hint="Active on site" />
        <StatCard
          label="On Hold"
          value={summary.onHold}
          tone={summary.onHold > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Completed"
          value={summary.completed}
          tone={summary.completed > 0 ? 'success' : 'default'}
        />
        <StatCard label="Cancelled" value={summary.cancelled} />
      </div>

      <Card>
        <InstallationList
          installations={summary.all}
          showTeamLead={seesTeam}
          emptyTitle="No installations yet"
          emptyDescription={emptyDescription}
        />
      </Card>
    </div>
  )
}
