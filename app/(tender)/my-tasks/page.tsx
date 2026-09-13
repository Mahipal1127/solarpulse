import { requireDepartment } from '@/lib/auth/guards'
import { getMyTasks } from '@/lib/services/tasks'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { MyTaskBoard } from '@/components/employee/MyTaskBoard'
import { AwaitingDelegationSection } from '@/components/shared/AwaitingDelegationSection'

export const dynamic = 'force-dynamic'

export default async function EmployeeDashboardPage() {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)

  // Tasks assigned to this person, plus the department's unclaimed queue — the same set
  // the header bell announces. RLS (member_view_relevant_tasks, 0006) governs the rows.
  const tasks = await getMyTasks(user)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">My Tasks</h1>
        <p className="mt-1 text-sm text-text-muted">
          Assigned to you by the CEO, plus your department&apos;s shared queue. Progress
          updates save live — no need to report them separately.
        </p>
      </header>

      {/* Manager only: delegate controls for the unclaimed queue the board below already lists. */}
      <AwaitingDelegationSection user={user} />

      <MyTaskBoard initialTasks={tasks} userId={user.id} />
    </div>
  )
}
