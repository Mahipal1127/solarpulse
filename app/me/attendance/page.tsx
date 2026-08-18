import { requireUser } from '@/lib/auth/guards'
import { listOwnAttendance } from '@/lib/services/hr'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { CheckInWidget } from '@/components/hr/CheckInWidget'
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_STYLES,
  formatDate,
  formatDateTime,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The signed-in employee's own attendance — the daily check-in surface, open to the
 * whole company. RLS returns only this employee's rows; the service resolves them from
 * the session user passed in.
 */
export default async function MyAttendancePage() {
  const user = await requireUser()
  const records = await listOwnAttendance(user)

  const today = new Date().toISOString().slice(0, 10)
  const todayRow = records.find((r) => r.date === today) ?? null

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">My Attendance</h1>
        <p className="mt-1 text-sm text-text-muted">
          Check in when your day starts and out when it ends. Your recent history is below.
        </p>
      </header>

      <Card className="px-5 py-4">
        <CheckInWidget
          checkedInAt={todayRow?.check_in ?? null}
          checkedOutAt={todayRow?.check_out ?? null}
        />
      </Card>

      <Card>
        <CardHeader title="Recent days" subtitle="Last 60 days" />
        {records.length === 0 ? (
          <EmptyState title="No attendance yet" description="Your check-ins will appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Date</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Check in</th>
                  <th className="px-4 py-3 font-semibold">Check out</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {records.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-brand-slate">{formatDate(r.date)}</td>
                    <td className="px-4 py-3">
                      <Badge className={ATTENDANCE_STATUS_STYLES[r.status]}>
                        {ATTENDANCE_STATUS_LABELS[r.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {r.check_in ? formatDateTime(r.check_in) : '—'}
                    </td>
                    <td className="px-4 py-3 text-text-muted">
                      {r.check_out ? formatDateTime(r.check_out) : '—'}
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
