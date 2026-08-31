import { requireUser } from '@/lib/auth/guards'
import { listOwnLeave } from '@/lib/services/hr'
import { listOwnApplications } from '@/lib/services/applications'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { LeaveRequestForm } from '@/components/hr/LeaveRequestForm'
import { ApplicationForm } from '@/components/shared/ApplicationForm'
import {
  LEAVE_TYPE_LABELS,
  LEAVE_STATUS_LABELS,
  LEAVE_STATUS_STYLES,
  APPLICATION_RECIPIENT_LABELS,
  APPLICATION_STATUS_LABELS,
  APPLICATION_STATUS_STYLES,
  formatDate,
  leaveDayCount,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The signed-in employee's Applications hub, open to the whole company. Two things live
 * here:
 *   - Apply for leave — the dedicated leave form (its own approvals flow); the request
 *     and its history mirror the CEO's decision.
 *   - Write an application — a free-text note to HR, the CEO, or both.
 * Below each, the person's own history of that kind.
 */
export default async function MyApplicationsPage() {
  const user = await requireUser()
  const [leave, applications] = await Promise.all([
    listOwnLeave(user),
    listOwnApplications(user),
  ])

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Applications</h1>
        <p className="mt-1 text-sm text-text-muted">
          Apply for leave or write an application to HR and the CEO, and track where each stands.
        </p>
      </header>

      <Card>
        <CardHeader title="Apply for leave" subtitle="Time off, decided by your leadership" />
        <div className="px-5 py-4">
          <LeaveRequestForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="Write an application" subtitle="A free-text note to HR, the CEO, or both" />
        <div className="px-5 py-4">
          <ApplicationForm />
        </div>
      </Card>

      <Card>
        <CardHeader title="My leave requests" />
        {leave.length === 0 ? (
          <EmptyState
            title="No leave requests"
            description="Leave you request appears here with its status."
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
                {leave.map((r) => (
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

      <Card>
        <CardHeader title="My applications" />
        {applications.length === 0 ? (
          <EmptyState
            title="No applications"
            description="Applications you write appear here with their status."
          />
        ) : (
          <div className="divide-y divide-border-subtle">
            {applications.map((a) => (
              <div key={a.id} className="px-5 py-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-brand-slate">{a.subject}</span>
                  <Badge className={APPLICATION_STATUS_STYLES[a.status]}>
                    {APPLICATION_STATUS_LABELS[a.status]}
                  </Badge>
                  <span className="text-[10px] font-medium uppercase tracking-wide text-text-muted">
                    → {APPLICATION_RECIPIENT_LABELS[a.recipient]}
                  </span>
                  <span className="ml-auto text-xs text-text-muted">{formatDate(a.created_at)}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-brand-slate">{a.body}</p>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
