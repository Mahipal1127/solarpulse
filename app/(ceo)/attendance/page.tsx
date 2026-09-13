import { requireRole } from '@/lib/auth/guards'
import { getAttendanceForDate } from '@/lib/hr/dashboard'
import { Card, CardHeader, EmptyState } from '@/components/ui/primitives'
import { AttendanceTable } from '@/components/hr/AttendanceTable/AttendanceTable'
import { formatDate } from '@/lib/format'
import type { AttendanceStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * CEO attendance — the same day roll-up HR sees, reached from the CEO sidebar.
 * Read-only by design (0024): employees mark their own via self check-in or the
 * QR kiosk; neither HR nor the CEO edits the record. The date is picked with
 * ?date= and defaults to today.
 *
 * WHY IT REUSES THE HR TABLE. One attendance table for the whole company, one
 * worked-hours rule; the CEO's page and HR's page draw the same numbers from
 * the same component, so they cannot drift apart.
 */
export default async function CeoAttendancePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  await requireRole('CEO')
  const { date } = await searchParams
  const targetDate = date ?? new Date().toISOString().slice(0, 10)

  const records = await getAttendanceForDate(targetDate)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Attendance</h1>
        <p className="mt-1 text-sm text-text-muted">
          The day&apos;s check-ins, check-outs and worked hours across the company — recorded by
          the QR kiosk at the door or self check-in.
        </p>
      </header>

      <Card>
        <CardHeader title="On record" subtitle={formatDate(targetDate)} />
        {records.length === 0 ? (
          <EmptyState
            title="Nothing recorded for this day"
            description="Kiosk scans and self check-ins for this date will show here."
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