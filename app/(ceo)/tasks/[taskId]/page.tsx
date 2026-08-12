import 'server-only'

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft, Paperclip } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, Badge, ProgressBar, EmptyState } from '@/components/ui/primitives'
import { TaskActions } from '@/components/ceo/TaskBoard/TaskActions'
import {
  formatDate,
  formatDateTime,
  isOverdue,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STATUS_DOT,
  STATUS_LABELS,
  STATUS_STYLES,
} from '@/lib/format'
import type { Task, TaskStatus, TaskPriority } from '@/lib/types'

/**
 * A single task: what it is, what has been reported against it, and what the CEO may
 * change about it.
 *
 * The page had no padding of its own. The (ceo) layout gives <main> none — every
 * sibling page supplies its own — so the cards here sat flush against the sidebar and
 * the window edge.
 *
 * Progress is read-only on this page and carries its reporter's name. The number is
 * only worth showing because someone specific stood behind it; see the note in
 * components/ceo/TaskBoard/TaskActions.tsx for why the CEO cannot author it.
 */

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
  const attachmentList = attachments ?? []
  const department = task.departments as unknown as { name: string } | null
  const assignee = task.assignee as unknown as { full_name: string } | null
  const creator = task.creator as unknown as { full_name: string } | null
  const overdue = isOverdue(task as Task)

  /*
   * Who last reported progress. The timeline is already ordered newest-first, so the
   * first entry carrying a number is the one behind the figure shown below — no second
   * query needed.
   *
   * Worth naming: a bare percentage invites the reader to treat it as fact about the
   * work. It is a claim by a specific person at a specific time, and the whole reason
   * the CEO cannot author it is that the name stays attached to it.
   */
  const progressReport = timeline.find((entry) => entry.progress_percent !== null)

  return (
    <div className="space-y-6 p-6 sm:p-8">
      <header>
        <Link
          href="/tasks"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-muted transition-colors hover:text-brand-slate"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to tasks
        </Link>

        {/*
          The badges sit in their own flex group so they wrap as a unit. Inline with
          the h1, a long title used to strand "Urgent" alone on the next line, reading
          as though it labelled nothing.
        */}
        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-brand-slate">
            {task.title}
          </h1>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Badge className={STATUS_STYLES[task.status as TaskStatus]}>
              {STATUS_LABELS[task.status as TaskStatus]}
            </Badge>
            <Badge className={PRIORITY_STYLES[task.priority as TaskPriority]}>
              {PRIORITY_LABELS[task.priority as TaskPriority]}
            </Badge>
            {/* badge-danger, not a hand-mixed danger tint — see the note above the
                *_STYLES maps in lib/format.ts. */}
            {overdue && <Badge className="badge-danger">Overdue</Badge>}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Details" />
            {/* One column until sm: two columns of label-over-value at phone width
                left every field about twelve characters wide. */}
            <dl className="grid grid-cols-1 gap-x-6 gap-y-5 px-5 py-4 text-sm sm:grid-cols-2">
              <Field label="Department" value={department?.name ?? '—'} />
              <Field label="Assignee" value={assignee?.full_name ?? 'Unassigned'} />
              <Field
                label="Due date"
                value={formatDate(task.due_date)}
                tone={overdue ? 'danger' : 'default'}
              />
              <Field label="Created by" value={creator?.full_name ?? '—'} />

              <div className="sm:col-span-2">
                <dt className={FIELD_LABEL}>Progress</dt>
                <dd className="mt-2">
                  <div className="flex items-center gap-3">
                    <div className="flex-1">
                      <ProgressBar value={task.progress_percent} />
                    </div>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-brand-slate">
                      {task.progress_percent}%
                    </span>
                  </div>
                  {/* Attribution, not decoration: this figure is somebody's claim, and
                      the CEO is deliberately not able to author it. */}
                  <p className="mt-1.5 text-xs text-text-muted">
                    {progressReport
                      ? `Reported by ${progressReport.users?.full_name ?? 'a team member'} · ${formatDateTime(progressReport.created_at)}`
                      : 'No progress reported yet by the assignee.'}
                  </p>
                </dd>
              </div>

              {task.description && (
                <div className="sm:col-span-2">
                  <dt className={FIELD_LABEL}>Description</dt>
                  {/* brand-slate, not muted: this is the task itself, not metadata
                      about it. */}
                  <dd className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-brand-slate">
                    {task.description}
                  </dd>
                </div>
              )}
            </dl>
          </Card>

          <Card>
            <CardHeader
              title="Progress reports"
              subtitle="Append-only. Posted by the people doing the work, newest first."
            />
            {timeline.length === 0 ? (
              <EmptyState
                title="No updates yet"
                description="Updates appear here as the assignee reports progress."
              />
            ) : (
              /*
                A threaded rail rather than divided rows. This is one chronological
                record, and horizontal dividers cut it into unrelated cards — the rail
                is what makes it read as a sequence. Each dot echoes the status the
                entry reported, so the shape of the work is scannable down the column.
              */
              <ol className="space-y-5 px-5 py-5">
                {timeline.map((entry, index) => {
                  const last = index === timeline.length - 1
                  return (
                    <li key={entry.id} className="relative flex gap-4">
                      {/* The rail stops at the final entry so it does not trail into
                          the card's bottom padding. */}
                      {!last && (
                        <span
                          aria-hidden
                          className="absolute left-[3.5px] top-4 h-full w-px bg-border-subtle"
                        />
                      )}
                      <span
                        aria-hidden
                        className={`relative z-10 mt-1.5 h-2 w-2 shrink-0 rounded-full ring-4 ring-surface-card ${
                          entry.status ? STATUS_DOT[entry.status] : 'bg-text-muted/40'
                        }`}
                      />

                      <div className="min-w-0 flex-1 pb-1">
                        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                          <p className="text-sm font-medium text-brand-slate">
                            {entry.users?.full_name ?? 'System'}
                          </p>
                          <p className="shrink-0 text-xs text-text-muted">
                            {formatDateTime(entry.created_at)}
                          </p>
                        </div>

                        {entry.note && (
                          <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                            {entry.note}
                          </p>
                        )}

                        {(entry.status || entry.progress_percent !== null) && (
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            {entry.status && (
                              <Badge className={STATUS_STYLES[entry.status]}>
                                {STATUS_LABELS[entry.status]}
                              </Badge>
                            )}
                            {entry.progress_percent !== null && (
                              <Badge className="badge-neutral">
                                {entry.progress_percent}% complete
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <TaskActions task={task as Task} />

          <Card>
            <CardHeader
              title="Attachments"
              subtitle={
                attachmentList.length > 0
                  ? `${attachmentList.length} file${attachmentList.length === 1 ? '' : 's'}`
                  : undefined
              }
            />
            {attachmentList.length === 0 ? (
              <EmptyState
                title="No attachments"
                description="Files the department uploads against this task appear here."
              />
            ) : (
              <ul className="divide-y divide-border-subtle">
                {attachmentList.map((file) => (
                  <li key={file.id} className="flex items-center gap-3 px-5 py-3">
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    <div className="min-w-0 flex-1">
                      {/* file_name is nullable; the storage path is the honest
                          fallback rather than an em dash for a file that exists. */}
                      <p className="truncate text-sm font-medium text-brand-slate">
                        {file.file_name ?? file.file_path}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {formatDate(file.created_at)}
                      </p>
                    </div>
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

/** Shared so the inline dt's in the grid above cannot drift from Field's own. */
const FIELD_LABEL = 'text-xs font-semibold uppercase tracking-wide text-text-muted'

function Field({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: string
  /**
   * 'danger' is for a value that is itself the problem — a due date already past.
   * The Overdue badge in the header says so too; this puts the signal on the actual
   * date, so the two agree rather than the date looking unremarkable next to it.
   */
  tone?: 'default' | 'danger'
}) {
  return (
    <div>
      <dt className={FIELD_LABEL}>{label}</dt>
      <dd
        className={`mt-1.5 text-sm font-medium ${
          tone === 'danger' ? 'text-status-danger' : 'text-brand-slate'
        }`}
      >
        {value}
      </dd>
    </div>
  )
}
