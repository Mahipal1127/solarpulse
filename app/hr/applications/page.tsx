import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { getLeaveQueue } from '@/lib/hr/dashboard'
import { listApplicationsForHr } from '@/lib/services/applications'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { ApplicationsInbox } from '@/components/shared/ApplicationsInbox'
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
 * HR Applications — everything employees send in, in one place:
 *   - Leave requests (the whole org's queue). Monitoring only: the DECISION is made on
 *     the CEO's Approvals page and its outcome flows back here.
 *   - Free-text applications addressed to HR (recipient 'hr' or 'both'), which HR works by
 *     advancing a lightweight status (submitted → acknowledged → closed).
 */
export default async function HrApplicationsPage() {
  await requireDepartment(HR_DEPARTMENT_SLUG)
  const [queue, applications] = await Promise.all([getLeaveQueue(), listApplicationsForHr()])

  const pending = queue.filter((l) => l.status === 'pending')
  const decided = queue.filter((l) => l.status !== 'pending')
  const openApplications = applications.filter((a) => a.status !== 'closed')

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Applications</h1>
        <p className="mt-1 text-sm text-text-muted">
          Leave requests and written applications from across the company. Leave is approved or
          rejected on the Approvals page; the outcome is reflected here.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Written applications"
          subtitle={`${openApplications.length} open`}
        />
        <ApplicationsInbox applications={applications} showRecipient />
      </Card>

      <Card>
        <CardHeader title="Leave — awaiting decision" subtitle={`${pending.length} pending`} />
        {pending.length === 0 ? (
          <EmptyState title="Nothing pending" description="New leave requests appear here." />
        ) : (
          <LeaveTable rows={pending} />
        )}
      </Card>

      <Card>
        <CardHeader title="Leave — decided" />
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
    employee_id: string
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
              <td className="px-4 py-3">
                <Link
                  href={`/hr/employees/${r.employee_id}`}
                  className="text-brand-slate hover:text-brand-gold hover:underline"
                >
                  {r.employee?.full_name ?? '—'}
                </Link>
              </td>
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
