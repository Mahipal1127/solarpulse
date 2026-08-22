import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { getEmployeeRoster, getAttendanceForDate } from '@/lib/hr/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { MarkAttendanceForm } from '@/components/hr/MarkAttendanceForm'
import { AttendanceTable } from '@/components/hr/AttendanceTable/AttendanceTable'
import { formatDate } from '@/lib/format'
import type { AttendanceStatus } from '@/lib/types'

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
          <div className="px-2 py-3">
            <AttendanceTable
              rows={records.map((r) => ({
                id: r.id,
                employeeId: r.employee_id,
                fullName: r.employee?.full_name ?? '—',
                status: r.status as AttendanceStatus,
                checkIn: r.check_in,
                checkOut: r.check_out,
                marked: Boolean(r.marked_by),
              }))}
            />
          </div>
        )}
      </Card>
    </div>
  )
}
