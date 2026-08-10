'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  isOverdue,
  STATUS_STYLES,
  STATUS_LABELS,
  PRIORITY_STYLES,
  PRIORITY_LABELS,
} from '@/lib/format'
import type { AssignedTask } from '@/components/employee/MyTaskBoard'

/**
 * Manager-only inbox for tasks the CEO assigned to a department without naming a
 * person. Delegating one sets assigned_user_id, which is what moves it out of here
 * and into that employee's own dashboard.
 *
 * Shared by Sales and Distribution — the only thing that differs between them is
 * the department's name in the copy, so keeping one component avoids the two
 * drifting apart.
 *
 * This goes through the existing PATCH /api/tasks/[taskId] rather than a
 * per-department endpoint. That route's guard admits department managers, and RLS
 * (member_update_relevant_tasks, migration 0006) keeps the write inside the
 * manager's own department — so a Sales Manager cannot push work onto Distribution
 * even though the endpoint is shared.
 */
export function DepartmentTaskInbox({
  tasks,
  employees,
  departmentName,
}: {
  tasks: AssignedTask[]
  employees: { id: string; full_name: string }[]
  /** Used in the copy only. The department a task belongs to is decided by RLS. */
  departmentName: string
}) {
  if (tasks.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting to be delegated"
        description={`Tasks the CEO assigns to ${departmentName} without naming a person land here for you to hand out.`}
      />
    )
  }

  return (
    <ul className="divide-y divide-border-subtle">
      {tasks.map((task) => (
        <InboxRow key={task.id} task={task} employees={employees} />
      ))}
    </ul>
  )
}

function InboxRow({
  task,
  employees,
}: {
  task: AssignedTask
  employees: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [assignee, setAssignee] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const over = isOverdue(task)

  async function delegate() {
    if (!assignee) return
    setPending(true)
    setError(null)

    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assigned_user_id: assignee }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not delegate the task.')
      return
    }

    setAssignee('')
    router.refresh()
  }

  return (
    <li
      className={`border-l-4 py-4 pl-4 pr-5 ${over ? 'border-l-rose-500' : 'border-l-transparent'}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-brand-slate">{task.title}</h3>
            {over && <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge className={PRIORITY_STYLES[task.priority]}>
              {PRIORITY_LABELS[task.priority]}
            </Badge>
            <Badge className={STATUS_STYLES[task.status]}>{STATUS_LABELS[task.status]}</Badge>
            {task.due_date && (
              <span className={`text-xs ${over ? 'font-medium text-status-danger' : 'text-text-muted'}`}>
                · Due {formatDate(task.due_date)}
              </span>
            )}
            {task.creator && (
              <span className="text-xs text-text-muted/60">· by {task.creator.full_name}</span>
            )}
          </div>

          {task.description && (
            <p className="text-xs leading-relaxed text-text-muted">{task.description}</p>
          )}
          {error && <p className="text-xs text-status-danger">⚠ {error}</p>}
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <select
            aria-label={`Delegate "${task.title}" to`}
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="rounded-lg border border-border-subtle bg-white px-2.5 py-1.5 text-xs outline-none focus:border-brand-gold"
          >
            <option value="">Delegate to…</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.full_name}
              </option>
            ))}
          </select>
          <button
            onClick={delegate}
            disabled={!assignee || pending}
            className="rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-50"
          >
            {pending ? 'Assigning…' : 'Assign'}
          </button>
        </div>
      </div>
    </li>
  )
}
