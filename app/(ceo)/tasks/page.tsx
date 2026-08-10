import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, Badge, EmptyState, ProgressBar } from '@/components/ui/primitives'
import { TaskFilters } from '@/components/ceo/TaskBoard/TaskFilters'
import {
  formatDate,
  isOverdue,
  PRIORITY_STYLES,
  STATUS_STYLES,
  STATUS_LABELS,
  PRIORITY_LABELS,
} from '@/lib/format'
import type { Task, Department, TaskStatus, TaskPriority } from '@/lib/types'

type TaskRow = Task & {
  departments: { name: string } | null
  assignee: { full_name: string } | null
}

export default async function TasksPage(props: PageProps<'/tasks'>) {
  const user = await requireRole('CEO')
  const searchParams = await props.searchParams

  const departmentFilter = asString(searchParams.department)
  const statusFilter = asString(searchParams.status)
  const priorityFilter = asString(searchParams.priority)
  const overdueOnly = asString(searchParams.overdue) === '1'

  const supabase = await createSupabaseServerClient()

  let query = supabase
    .from('tasks')
    .select(
      'id, title, status, priority, due_date, progress_percent, assigned_department_id, assigned_user_id, created_at, updated_at, organization_id, description, created_by, departments!tasks_assigned_department_id_fkey(name), assignee:users!tasks_assigned_user_id_fkey(full_name)'
    )
    .eq('organization_id', user.organization_id)
    .order('created_at', { ascending: false })
    .limit(200)

  if (departmentFilter) query = query.eq('assigned_department_id', departmentFilter)
  if (priorityFilter) query = query.eq('priority', priorityFilter)
  if (statusFilter) {
    query = query.eq('status', statusFilter)
  } else {
    // Archived tasks are hidden unless explicitly asked for.
    query = query.neq('status', 'archived')
  }

  const [{ data: taskData }, { data: departmentData }] = await Promise.all([
    query,
    supabase
      .from('departments')
      .select('id, name, slug, organization_id, parent_department_id, created_at')
      .eq('organization_id', user.organization_id)
      .order('name'),
  ])

  const departments = (departmentData ?? []) as Department[]
  let tasks = (taskData ?? []) as unknown as TaskRow[]

  // Overdue is derived here rather than filtered in SQL, because a task whose
  // department never flagged it still counts as delayed.
  if (overdueOnly) tasks = tasks.filter(isOverdue)

  const overdueCount = tasks.filter(isOverdue).length
  const PRIORITY_BORDER = {
    urgent: 'border-l-rose-500',
    high: 'border-l-orange-500',
    medium: 'border-l-blue-500',
    low: 'border-l-slate-400',
  }

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Tasks</h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-text-muted">
            <span>{tasks.length} total</span>
            {overdueCount > 0 && (
              <>
                <span>·</span>
                <span className="font-medium text-status-danger">{overdueCount} overdue</span>
              </>
            )}
          </div>
        </div>
        <Link
          href="/tasks/new"
          className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-orange transition-colors"
        >
          + New task
        </Link>
      </div>

      {/* Filters */}
      <Card className="mb-6 p-4">
        <TaskFilters departments={departments} />
      </Card>

      {/* Task list */}
      <Card>
        {tasks.length === 0 ? (
          <EmptyState
            title="No tasks match these filters"
            description="Try clearing a filter, or create a new task to assign work to a department."
          />
        ) : (
          <div className="divide-y divide-border-subtle">
            {tasks.map((task) => {
              const overdue = isOverdue(task)
              const priorityBorder = PRIORITY_BORDER[task.priority as TaskPriority]
              return (
                <Link
                  key={task.id}
                  href={`/tasks/${task.id}`}
                  className={`block border-l-4 ${priorityBorder} pl-4 pr-5 py-4 transition hover:bg-surface-bg`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="truncate text-sm font-semibold text-brand-slate">{task.title}</h3>
                        {overdue && (
                          <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
                        <span className="font-medium text-text-muted">{task.departments?.name ?? 'Unassigned'}</span>
                        {task.assignee && (
                          <>
                            <span>·</span>
                            <span>{task.assignee.full_name}</span>
                          </>
                        )}
                        {task.due_date && (
                          <>
                            <span>·</span>
                            <span>Due {formatDate(task.due_date)}</span>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="flex-1 max-w-xs">
                          <ProgressBar value={task.progress_percent} />
                        </div>
                        <span className="text-xs font-medium text-text-muted">{task.progress_percent}%</span>
                      </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <Badge className={STATUS_STYLES[task.status as TaskStatus]}>
                        {STATUS_LABELS[task.status as TaskStatus]}
                      </Badge>
                      <Badge className={PRIORITY_STYLES[task.priority as TaskPriority]}>
                        {PRIORITY_LABELS[task.priority as TaskPriority]}
                      </Badge>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
