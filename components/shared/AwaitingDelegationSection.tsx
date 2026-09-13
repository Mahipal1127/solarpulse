import { Card, CardHeader } from '@/components/ui/primitives'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import {
  getDelegableDepartmentMembers,
  getTasksAwaitingDelegation,
} from '@/lib/services/tasks'
import { isDepartmentManager, type SessionUser } from '@/lib/auth/guards'
import type { AssignedTask } from '@/components/employee/MyTaskBoard'

/**
 * "Tasks awaiting delegation", as a drop-in section for the /my-tasks pages.
 *
 * WHY THIS EXISTS
 * The delegation inbox used to live only on each department's dashboard, so a
 * manager had to know which page to check — a CEO-assigned task with no named
 * owner was easy to miss. Rendering the same inbox here, above the personal
 * board, puts everything a manager needs on the one tab they open every day.
 *
 * MANAGER-ONLY, AND QUIET FOR EVERYONE ELSE
 * Delegation is a manager's action: isDepartmentManager mirrors
 * auth_is_department_manager() (0006), and 0022 tightened task updates to the
 * same gate. For any other visitor this renders nothing — no card, no queries.
 * The CEO passes requireDepartment but fails the manager check, so their
 * read-only tour of a module's /my-tasks stays clean, exactly as on the
 * dashboards.
 *
 * The rows themselves are still RLS-governed: the service reads with the
 * session-bound client, and member_view_relevant_tasks (0006) already lets
 * department members see unclaimed rows. RLS remains the boundary; this
 * component only decides who is offered the controls.
 */
export async function AwaitingDelegationSection({ user }: { user: SessionUser }) {
  if (!isDepartmentManager(user)) return null

  const departmentName = user.departmentName ?? 'your department'
  const [tasks, members] = await Promise.all([
    getTasksAwaitingDelegation(user),
    getDelegableDepartmentMembers(user),
  ])

  return (
    <Card>
      <CardHeader
        title="Tasks awaiting delegation"
        subtitle={`Assigned to ${departmentName} by the CEO without a named owner. Delegating moves it to that person's dashboard.`}
      />
      <DepartmentTaskInbox
        tasks={tasks as unknown as AssignedTask[]}
        employees={members}
        departmentName={departmentName}
      />
    </Card>
  )
}