import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { getAttendanceForDate } from '@/lib/hr/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { AttendanceTable } from '@/components/hr/AttendanceTable/AttendanceTable'
import { formatDate } from '@/lib/format'
import type { AttendanceStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * HR attendance — READ-ONLY. HR reviews the day's roll-up; it does not mark attendance
 * for anyone. Every employee marks their own, either via self check-in at /me/attendance
 * or the allotted QR (a separate kiosk that writes through the service-role client). The
 * date can be picked via ?date=; defaults to today.
 */
export default async function HrAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireDepartment(HR_DEPARTMENT_SLUG)
  const { date } = await searchParams
  const targetDate = date ?? new Date().toISOString().slice(0, 10)

  const records = await getAttendanceForDate(targetDate)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Attendance</h1>
        <p className="mt-1 text-sm text-text-muted">
          The day&apos;s attendance across the company. Employees mark their own — by checking in
          from their workspace or scanning their allotted QR.
        </p>
      </header>

      <Card>
        <CardHeader title="On record" subtitle={formatDate(targetDate)} />
        {records.length === 0 ? (
          <EmptyState
            title="Nothing recorded for this day"
            description="Self check-in and QR-scanned rows for this date will show here."
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
