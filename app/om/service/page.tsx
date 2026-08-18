import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, StatCard } from '@/components/ui/primitives'
import { ServiceTicketQueue } from '@/components/om/ServiceTicketQueue/ServiceTicketQueue'
import { getServiceSummary } from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { SERVICE_TICKET_OPEN_STATUSES, SERVICE_PRIORITY_RANK } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function ServicePage() {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, OM_DEPARTMENT_SLUG)

  const summary = await getServiceSummary(user.organization_id)

  // The queue's job: open tickets first, worst priority first, then oldest first —
  // the order a dispatcher works down. Resolved/closed sink to the bottom by date.
  const ordered = [...summary.all].sort((a, b) => {
    const aOpen = SERVICE_TICKET_OPEN_STATUSES.includes(a.status)
    const bOpen = SERVICE_TICKET_OPEN_STATUSES.includes(b.status)
    if (aOpen !== bOpen) return aOpen ? -1 : 1
    if (aOpen) {
      const rank = SERVICE_PRIORITY_RANK[b.priority] - SERVICE_PRIORITY_RANK[a.priority]
      if (rank !== 0) return rank
      return a.created_at.localeCompare(b.created_at)
    }
    return b.created_at.localeCompare(a.created_at)
  })

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Service</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            <span>{summary.open} open</span>
            <span>·</span>
            <span>{summary.total} total</span>
          </div>
        </div>
        {!readOnly && (
          <Link
            href="/om/service/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + Log ticket
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Urgent / High"
          value={summary.urgent}
          hint="Open, needs attention"
          tone={summary.urgent > 0 ? 'danger' : 'default'}
        />
        <StatCard
          label="Unassigned"
          value={summary.unassigned}
          hint="Open, no owner"
          tone={summary.unassigned > 0 ? 'warning' : 'default'}
        />
        <StatCard label="In Progress" value={summary.inProgress} />
        <StatCard label="Resolved" value={summary.resolved} tone="success" />
      </div>

      <Card>
        <ServiceTicketQueue
          tickets={ordered}
          emptyTitle="No service tickets"
          emptyDescription={
            readOnly
              ? 'The Operations & Maintenance department has not logged a service ticket yet.'
              : 'Log a complaint to start tracking it through to resolution.'
          }
        />
      </Card>
    </div>
  )
}
