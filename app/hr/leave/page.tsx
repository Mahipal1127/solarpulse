import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { getLeaveQueue } from '@/lib/hr/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import {
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_STYLES,
  formatDate,
  leaveDayCount,
} from '@/lib/format'
import type { LeaveStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The HR leave queue — every request across the org, most recent first. This is a
 * monitoring view: the DECISION on a leave request is made on the CEO's Approvals page
 * (a leave request creates a linked approval, and deciding it there propagates the
 * status back here). Surfacing the decision in one place — the same Approvals page every
 * other request type uses — keeps HR from being a second, parallel approval mechanism.
 */
export default async function HrLeavePage() {
  await requireDepartment(HR_DEPARTMENT_SLUG)
  const queue = await getLeaveQueue()

  const pending = queue.filter((l) => l.status === 'pending')
  const decided = queue.filter((l) => l.status !== 'pending')

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Leave</h1>
        <p className="mt-1 text-sm text-text-muted">
          All leave requests across the company. Requests are approved or rejected from the
          Approvals page; the outcome is reflected here.
        </p>
      </header>

      <Card>
        <CardHeader title="Awaiting decision" subtitle={`${pending.length} pending`} />
        {pending.length === 0 ? (
          <EmptyState title="Nothing pending" description="New leave requests appear here." />
        ) : (
          <LeaveTable rows={pending} />
        )}
      </Card>

      <Card>
        <CardHeader title="Decided" />
        {decided.length === 0 ? (
          <EmptyState title="No decided requests yet" />
        ) : (
          <LeaveTable rows={decided} />
        )}
      </Card>
    </div>
  )
}

function LeaveTable({
  rows,
}: {
  rows: {
    id: string
    leave_type: keyof typeof LEAVE_TYPE_LABELS
    start_date: string
    end_date: string
    status: LeaveStatus
    reason: string | null
    employee: { full_name: string } | null
  }[]
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
            <th className="px-4 py-3 font-semibold">Employee</th>
            <th className="px-4 py-3 font-semibold">Type</th>
            <th className="px-4 py-3 font-semibold">From</th>
            <th className="px-4 py-3 font-semibold">To</th>
            <th className="px-4 py-3 text-right font-semibold">Days</th>
            <th className="px-4 py-3 font-semibold">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {rows.map((r) => (
            <tr key={r.id} className="transition-colors hover:bg-surface-bg">
              <td className="px-4 py-3 text-brand-slate">{r.employee?.full_name ?? '—'}</td>
              <td className="px-4 py-3 text-text-muted">{LEAVE_TYPE_LABELS[r.leave_type]}</td>
              <td className="px-4 py-3 text-text-muted">{formatDate(r.start_date)}</td>
              <td className="px-4 py-3 text-text-muted">{formatDate(r.end_date)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-brand-slate">
                {leaveDayCount(r.start_date, r.end_date)}
              </td>
              <td className="px-4 py-3">
                <Badge className={LEAVE_STATUS_STYLES[r.status]}>
                  {LEAVE_STATUS_LABELS[r.status]}
                </Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
