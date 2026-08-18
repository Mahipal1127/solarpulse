import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { AgingBadge } from '@/components/discom/AgingBadge'
import { NET_METERING_STATUS_STYLES, NET_METERING_STATUS_LABELS } from '@/lib/format'
import type { NetMeteringWithAging } from '@/lib/discom/dashboard'

/**
 * The net-metering case table, sorted longest-stuck-first by the caller. The aging
 * column is the point: a stale case (past the threshold, still live) shows a red
 * days-in-status badge so the queue reads as "who's been waiting on the board, and
 * for how long" rather than a flat list. RLS decides which rows arrive — a liaison
 * gets their own, a lead/CEO the department's — so there is no owner filter here.
 */
export function NetMeteringList({
  applications,
  showAssignee,
  emptyTitle,
  emptyDescription,
}: {
  applications: NetMeteringWithAging[]
  showAssignee: boolean
  emptyTitle: string
  emptyDescription: string
}) {
  if (applications.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Customer</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">In status</th>
            <th className="px-5 py-3">DISCOM</th>
            {showAssignee && <th className="px-5 py-3">Liaison</th>}
          </tr>
        </thead>
        <tbody>
          {applications.map((app) => (
            <tr
              key={app.id}
              className="border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/discom/net-metering/${app.id}`}
                  className="font-medium text-brand-slate hover:text-brand-gold"
                >
                  {app.customer?.name ?? 'Unknown customer'}
                </Link>
                {app.installation?.address && (
                  <p className="mt-0.5 truncate text-xs text-text-muted">{app.installation.address}</p>
                )}
              </td>
              <td className="px-5 py-3">
                <Badge className={NET_METERING_STATUS_STYLES[app.status]}>
                  {NET_METERING_STATUS_LABELS[app.status]}
                </Badge>
              </td>
              <td className="px-5 py-3">
                <AgingBadge days={app.daysInStatus} isStale={app.isStale} />
              </td>
              <td className="px-5 py-3 text-text-muted">{app.discom_name ?? '—'}</td>
              {showAssignee && (
                <td className="px-5 py-3 text-text-muted">
                  {app.assignee?.full_name ?? 'Unassigned'}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
