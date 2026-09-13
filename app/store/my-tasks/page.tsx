import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { AwaitingDelegationSection } from '@/components/shared/AwaitingDelegationSection'

export const dynamic = 'force-dynamic'

/**
 * A Store employee's own task list — the same board every other module gets. Filtered by
 * assigned_user_id; RLS restricts the rows further. Department-wide tasks the CEO gave Store
 * without naming anyone render for the lead in the delegation section above the board (they
 * used to live on the dashboard's delegation view alone) — handing those out is the lead's job.
 */
export default async function StoreMyTasksPage() {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('tasks')
    .select(
      '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'
    )
    .eq('assigned_user_id', user.id)
    .neq('status', 'archived')
    .order('due_date', { ascending: true, nullsFirst: false })

  const tasks = (data ?? []) as unknown as AssignedTask[]

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">My Tasks</h1>
        <p className="mt-1 text-sm text-text-muted">
          Assigned to you by the CEO or your lead. Progress updates save live — no need to report
          them separately.
        </p>
      </header>

      <AwaitingDelegationSection user={user} />

      <MyTaskBoard initialTasks={tasks} userId={user.id} />
    </div>
  )
}
