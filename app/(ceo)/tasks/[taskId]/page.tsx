import Link from 'next/link'
import { notFound } from 'next/navigation'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, ProgressBar, EmptyState } from '@/components/ui/primitives'
import { TaskActions } from '@/components/ceo/TaskBoard/TaskActions'
import {
  formatDate,
  formatDateTime,
  isOverdue,
  PRIORITY_STYLES,
  STATUS_STYLES,
  STATUS_LABELS,
  PRIORITY_LABELS,
} from '@/lib/format'
import type { Task, TaskStatus, TaskPriority } from '@/lib/types'

type TimelineEntry = {
  id: string
  note: string | null
  progress_percent: number | null
  status: TaskStatus | null
  created_at: string
  users: { full_name: string } | null
}

export default async function TaskDetailPage(props: PageProps<'/tasks/[taskId]'>) {
  await requireRole('CEO')
  const { taskId } = await props.params
  const supabase = await createSupabaseServerClient()

  const { data: task } = await supabase
    .from('tasks')
    .select(
      '*, departments!tasks_assigned_department_id_fkey(name), assignee:users!tasks_assigned_user_id_fkey(full_name), creator:users!tasks_created_by_fkey(full_name)'
    )
    .eq('id', taskId)
    .maybeSingle()

  if (!task) notFound()

  const [{ data: updates }, { data: attachments }] = await Promise.all([
    supabase
      .from('task_updates')
      .select('id, note, progress_percent, status, created_at, users(full_name)')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false }),
    supabase
      .from('task_attachments')
      .select('id, file_path, file_name, created_at')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false }),
  ])

  const timeline = (updates ?? []) as unknown as TimelineEntry[]
  const department = task.departments as unknown as { name: string } | null
  const assignee = task.assignee as unknown as { full_name: string } | null
  const creator = task.creator as unknown as { full_name: string } | null
  const overdue = isOverdue(task as Task)

  return (
    <div className="space-y-6">
      <header>
        <Link href="/tasks" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to tasks
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold text-brand-slate">{task.title}</h1>
          <Badge className={STATUS_STYLES[task.status as TaskStatus]}>
            {STATUS_LABELS[task.status as TaskStatus]}
          </Badge>
          <Badge className={PRIORITY_STYLES[task.priority as TaskPriority]}>
            {PRIORITY_LABELS[task.priority as TaskPriority]}
          </Badge>
          {overdue && <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/25">Overdue</Badge>}
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            <dl className="grid grid-cols-2 gap-4 px-5 py-4 text-sm">
              <Field label="Department" value={department?.name ?? '—'} />
              <Field label="Assignee" value={assignee?.full_name ?? 'Unassigned'} />
              <Field label="Due date" value={formatDate(task.due_date)} />
              <Field label="Created by" value={creator?.full_name ?? '—'} />
              <div className="col-span-2">
                <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Progress
                </dt>
                <dd className="mt-2 flex items-center gap-3">
                  <div className="flex-1">
                    <ProgressBar value={task.progress_percent} />
                  </div>
                  <span className="text-sm font-medium text-text-muted">
                    {task.progress_percent}%
                  </span>
                </dd>
              </div>
              {task.description && (
                <div className="col-span-2">
                  <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">
                    Description
                  </dt>
                  <dd className="mt-1 whitespace-pre-wrap text-sm text-text-muted">
                    {task.description}
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Live progress"
              subtitle="Append-only log — updates posted by the assigned department"
            />
            {timeline.length === 0 ? (
              <EmptyState
                title="No updates yet"
                description="Updates will appear here as the department reports progress."
              />
            ) : (
              <ol className="divide-y divide-border-subtle">
                {timeline.map((entry) => (
                  <li key={entry.id} className="px-5 py-4">
                    <div className="flex items-baseline justify-between gap-4">
                      <p className="text-sm font-medium text-brand-slate">
                        {entry.users?.full_name ?? 'System'}
                      </p>
                      <p className="shrink-0 text-xs text-text-muted">
                        {formatDateTime(entry.created_at)}
                      </p>
                    </div>
                    {entry.note && <p className="mt-1 text-sm text-text-muted">{entry.note}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {entry.status && (
                        <Badge className={STATUS_STYLES[entry.status]}>
                          {STATUS_LABELS[entry.status]}
                        </Badge>
                      )}
                      {entry.progress_percent !== null && (
                        <Badge className="bg-surface-bg text-text-muted ring-border-subtle">
                          {entry.progress_percent}% complete
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <TaskActions task={task as Task} />

          <Card>
            <CardHeader title="Attachments" />
            {(attachments ?? []).length === 0 ? (
              <EmptyState title="No attachments" />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {(attachments ?? []).map((file) => (
                  <li key={file.id} className="px-5 py-3">
                    <p className="truncate text-sm text-brand-slate">
                      {file.file_name ?? file.file_path}
                    </p>
                    <p className="text-xs text-text-muted">{formatDate(file.created_at)}</p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</dt>
      <dd className="mt-1 text-sm text-brand-slate">{value}</dd>
    </div>
  )
}
