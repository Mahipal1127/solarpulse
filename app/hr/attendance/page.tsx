import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { getEmployeeRoster, getAttendanceForDate } from '@/lib/hr/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { MarkAttendanceForm } from '@/components/hr/MarkAttendanceForm'
import {
  ATTENDANCE_STATUS_LABELS,
  ATTENDANCE_STATUS_STYLES,
  formatDate,
  formatDateTime,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * HR attendance — marking attendance and the day's roll-up. The date can be picked via
 * ?date=; defaults to today. Standard three-tier: HR members mark, CEO reads. Self
 * check-in/out for every employee lives at /me/attendance instead.
 */
export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, HR_DEPARTMENT_SLUG)
  const { date } = await searchParams
  const targetDate = date ?? new Date().toISOString().slice(0, 10)

  const [roster, records] = await Promise.all([
    getEmployeeRoster(),
    getAttendanceForDate(targetDate),
  ])

  const activeRoster = roster
    .filter((e) => e.employment_status !== 'exited')
    .map((e) => ({ employee_id: e.employee_id, full_name: e.full_name }))

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Attendance</h1>
        <p className="mt-1 text-sm text-text-muted">
          Mark attendance for staff and review the day. Employees can also check in themselves from
          their own workspace.
        </p>
      </header>

      {!readOnly && (
        <Card>
          <CardHeader title="Mark attendance" />
          <div className="px-5 py-4">
            <MarkAttendanceForm employees={activeRoster} defaultDate={targetDate} />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="On record" subtitle={formatDate(targetDate)} />
        {records.length === 0 ? (
          <EmptyState
            title="Nothing recorded for this day"
            description="Marked and self check-in rows for this date will show here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Check in</th>
                  <th className="px-4 py-3 font-semibold">Check out</th>
                  <th className="px-4 py-3 font-semibold">Source</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {records.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-brand-slate">{r.employee?.full_name ?? '—'}</td>
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
                    <td className="px-4 py-3 text-text-muted">
                      {r.marked_by ? 'HR marked' : 'Self'}
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
