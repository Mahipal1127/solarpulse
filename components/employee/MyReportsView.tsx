import { listOwnReports } from '@/lib/services/employee-reports'
import { EmployeeReportBoard } from '@/components/employee/EmployeeReportBoard'
import type { SessionUser } from '@/lib/auth/guards'

/**
 * The whole "My Reports" page, minus the department guard.
 *
 * Ten modules render this. The guard cannot live here — each module's page must call its
 * OWN requireDepartment so a Sales visitor reaching /technical/my-reports is turned away
 * by Technical's guard, exactly as my-tasks does it. Everything after that point is
 * identical work, so it lives here once instead of in ten near-copies.
 */
export async function MyReportsView({ user }: { user: SessionUser }) {
  const reports = await listOwnReports(user)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">My Reports</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your daily, weekly and monthly report of your own work. Generate a draft from your
          records, edit it, attach a file if you have one, and submit — your manager and the CEO
          read what you file.
        </p>
      </header>

      <EmployeeReportBoard
        initialReports={reports}
        organizationId={user.organization_id}
        userId={user.id}
      />
    </div>
  )
}
