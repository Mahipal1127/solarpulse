import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'

export const dynamic = 'force-dynamic'

/**
 * Tasks assigned to this person specifically, nothing else. The department's
 * unowned tasks live on the manager's team tab — an executive should never see a
 * colleague's task here, which migration 0006's member_view_relevant_tasks
 * enforces regardless of what this query asks for.
 */
export default async function SalesMyTasksPage() {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
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
          Assigned to you by the CEO. Progress updates save live — no need to report them
          separately.
        </p>
      </header>

      <MyTaskBoard initialTasks={tasks} userId={user.id} />
    </div>
  )
}
