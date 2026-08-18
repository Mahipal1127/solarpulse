import { requireAnyDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'

export const dynamic = 'force-dynamic'

/**
 * A Finance/Accounts person's own task list — the same board every module gets. Filtered by
 * assigned_user_id; RLS restricts the rows. CEO tasks handed to Finance without a named owner
 * stay on the dashboard's delegation inbox for the lead.
 */
export default async function FinanceMyTasksPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
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

      <MyTaskBoard initialTasks={tasks} userId={user.id} />
    </div>
  )
}
