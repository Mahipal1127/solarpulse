import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, StatCard } from '@/components/ui/primitives'
import { AMCTracker } from '@/components/om/AMCTracker/AMCTracker'
import { getAmcSummary } from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { formatCurrency } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function AMCPage() {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, OM_DEPARTMENT_SLUG)

  const summary = await getAmcSummary(user.organization_id)

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">AMC contracts</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            <span>{summary.active} active</span>
            <span>·</span>
            <span>{summary.total} total</span>
          </div>
        </div>
        {!readOnly && (
          <Link
            href="/om/amc/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + New contract
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Active" value={summary.active} tone="success" />
        <StatCard
          label="Expiring Soon"
          value={summary.expiringSoon}
          hint="Within 30 days"
          tone={summary.expiringSoon > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Expired"
          value={summary.expired}
          hint="Active but past end date"
          tone={summary.expired > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Active Value"
          value={formatCurrency(summary.activeValue)}
          hint="Sum of active contracts"
        />
      </div>

      <Card>
        <AMCTracker
          contracts={summary.all}
          emptyTitle="No AMC contracts"
          emptyDescription={
            readOnly
              ? 'The Operations & Maintenance department has not opened an AMC contract yet.'
              : 'Open a contract to schedule and track maintenance visits.'
          }
        />
      </Card>
    </div>
  )
}
