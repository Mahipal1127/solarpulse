import { requireUser } from '@/lib/auth/guards'
import { listOwnLeave } from '@/lib/services/hr'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { LeaveRequestForm } from '@/components/hr/LeaveRequestForm'
import {
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_STYLES,
  formatDate,
  leaveDayCount,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The signed-in employee's own leave — request form plus their history. Open to the
 * whole company. Submitting creates the request and its linked approval together; the
 * status here mirrors the CEO's decision once made.
 */
export default async function MyLeavePage() {
  const user = await requireUser()
  const requests = await listOwnLeave(user)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">My Leave</h1>
        <p className="mt-1 text-sm text-text-muted">
          Request time off and track where each request stands. Approvals are decided by your
          leadership.
        </p>
      </header>

      <Card>
        <CardHeader title="Request leave" />
        <div className="px-5 py-4">
          <LeaveRequestForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="My requests" />
        {requests.length === 0 ? (
          <EmptyState
            title="No leave requests"
            description="Requests you submit appear here with their status."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Type</th>
                  <th className="px-4 py-3 font-semibold">From</th>
                  <th className="px-4 py-3 font-semibold">To</th>
                  <th className="px-4 py-3 text-right font-semibold">Days</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {requests.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-brand-slate">{LEAVE_TYPE_LABELS[r.leave_type]}</td>
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
        )}
      </Card>
    </div>
  )
}
