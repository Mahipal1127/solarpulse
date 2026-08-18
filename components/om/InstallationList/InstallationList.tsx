import Link from 'next/link'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  INSTALLATION_STATUS_STYLES,
  INSTALLATION_STATUS_LABELS,
} from '@/lib/format'
import type { InstallationWithContext } from '@/lib/om/dashboard'

/**
 * The installation table. Presentational and server-rendered: which rows arrive is
 * RLS's call (a technician gets their sites, a lead the department's), so there is
 * no owner filter here — the same reason the Sales and Technical lists carry none.
 */
export function InstallationList({
  installations,
  showTeamLead,
  emptyTitle,
  emptyDescription,
}: {
  installations: InstallationWithContext[]
  /** A lead/CEO sees whose site is whose; a technician's rows are all their own. */
  showTeamLead: boolean
  emptyTitle: string
  emptyDescription: string
}) {
  if (installations.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
            <th className="px-5 py-3">Customer</th>
            <th className="px-5 py-3">Status</th>
            <th className="px-5 py-3">System size</th>
            {showTeamLead && <th className="px-5 py-3">Team lead</th>}
            <th className="px-5 py-3">Scheduled</th>
          </tr>
        </thead>
        <tbody>
          {installations.map((inst) => (
            <tr
              key={inst.id}
              className="border-b border-border-subtle/60 transition-colors last:border-0 hover:bg-surface-bg"
            >
              <td className="px-5 py-3">
                <Link
                  href={`/om/installations/${inst.id}`}
                  className="font-medium text-brand-slate hover:text-brand-gold"
                >
                  {inst.customer?.name ?? 'Unknown customer'}
                </Link>
                {inst.address && (
                  <p className="mt-0.5 truncate text-xs text-text-muted">{inst.address}</p>
                )}
              </td>
              <td className="px-5 py-3">
                <Badge className={INSTALLATION_STATUS_STYLES[inst.status]}>
                  {INSTALLATION_STATUS_LABELS[inst.status]}
                </Badge>
              </td>
              <td className="px-5 py-3 text-text-muted">
                {inst.system_size_kw !== null ? `${inst.system_size_kw} kW` : '—'}
              </td>
              {showTeamLead && (
                <td className="px-5 py-3 text-text-muted">
                  {inst.team_lead?.full_name ?? 'Unassigned'}
                </td>
              )}
              <td className="px-5 py-3 text-text-muted">
                {inst.scheduled_start_date ? formatDate(inst.scheduled_start_date) : 'Not set'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
