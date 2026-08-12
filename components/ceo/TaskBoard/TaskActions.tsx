'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader } from '@/components/ui/primitives'
import type { Task, TaskStatus, TaskPriority } from '@/lib/types'

/**
 * The CEO's management panel for a single task.
 *
 * WHAT IS NOT HERE, AND WHY
 * There used to be a progress slider on this card, under the heading "Post update".
 * It is gone. Every write to a task appends a `task_updates` row stamped with
 * `updated_by`, so dragging that slider filed a progress report in the CEO's name
 * on somebody else's work — "60% done" stopped meaning the assignee said so, and
 * the timeline it fed stopped being evidence of anything. Progress is reported up
 * by the person doing the work, through PATCH /api/tasks/[taskId]/progress.
 *
 * What management genuinely needs is all still here: retarget the work (priority,
 * due date), record a decision (status, note), or take it off the board (archive).
 * The task's current progress is shown read-only on the page beside this card,
 * attributed to whoever reported it.
 */

const fieldClass =
  'mt-1 w-full rounded-lg border border-border-subtle bg-surface-card px-3 py-2 text-sm text-brand-slate outline-none transition-colors focus:border-brand-gold'

const labelClass = 'block text-xs font-semibold uppercase tracking-wide text-text-muted'

export function TaskActions({ task }: { task: Task }) {
  const router = useRouter()
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [priority, setPriority] = useState<TaskPriority>(task.priority)
  // <input type="date"> wants YYYY-MM-DD; the column is a timestamptz.
  const [dueDate, setDueDate] = useState(task.due_date ? task.due_date.slice(0, 10) : '')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  const archived = task.status === 'archived'

  const dirty =
    status !== task.status ||
    priority !== task.priority ||
    dueDate !== (task.due_date ? task.due_date.slice(0, 10) : '') ||
    note.trim().length > 0

  async function save() {
    setPending(true)
    setError(null)

    /*
     * Only changed fields go up. updateTaskSchema rejects an empty object, and
     * sending unchanged values would append a timeline row saying nothing
     * happened.
     */
    const body: Record<string, unknown> = {}
    if (status !== task.status) body.status = status
    if (priority !== task.priority) body.priority = priority
    if (dueDate !== (task.due_date ? task.due_date.slice(0, 10) : '')) {
      // Midnight local, then ISO — the schema requires a full date-time.
      body.due_date = dueDate ? new Date(`${dueDate}T00:00:00`).toISOString() : null
    }
    if (note.trim()) body.note = note.trim()

    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })

    setPending(false)
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      setError(payload.error ?? 'Could not update the task.')
      return
    }

    setNote('')
    router.refresh()
  }

  async function archive() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' })

    setPending(false)
    setConfirmArchive(false)
    if (!res.ok) {
      const payload = await res.json().catch(() => ({}))
      setError(payload.error ?? 'Could not archive the task.')
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader title="Manage task" subtitle="Retarget, record a decision, or archive" />

      <div className="space-y-4 px-5 py-4">
        <div>
          <label htmlFor="task-status" className={labelClass}>
            Status
          </label>
          <select
            id="task-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            disabled={archived}
            className={fieldClass}
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="delayed">Delayed</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div>
          <label htmlFor="task-priority" className={labelClass}>
            Priority
          </label>
          <select
            id="task-priority"
            value={priority}
            onChange={(e) => setPriority(e.target.value as TaskPriority)}
            disabled={archived}
            className={fieldClass}
          >
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </div>

        <div>
          <label htmlFor="task-due" className={labelClass}>
            Due date
          </label>
          <input
            id="task-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={archived}
            className={fieldClass}
          />
        </div>

        <div>
          <label htmlFor="task-note" className={labelClass}>
            Note
          </label>
          <textarea
            id="task-note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={archived}
            className={fieldClass}
            placeholder="Context for this decision. Appears on the timeline under your name."
          />
        </div>

        {error && (
          <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-xs text-status-danger">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={pending || archived || !dirty}
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save changes'}
          </button>

          {!archived && (
            <button
              onClick={() => setConfirmArchive(true)}
              disabled={pending}
              className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg disabled:opacity-60"
            >
              Archive
            </button>
          )}
        </div>

        {archived && (
          <p className="text-xs text-text-muted">
            This task is archived. Its record is kept and still appears when filtering for
            archived tasks.
          </p>
        )}
      </div>

      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-slate/50 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-border-subtle bg-surface-card p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-brand-slate">Archive this task?</h3>
            <p className="mt-2 text-sm text-text-muted">
              It will be hidden from the default task list. The record is kept and can still be
              found by filtering for archived tasks.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmArchive(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-bg"
              >
                Cancel
              </button>
              <button
                onClick={archive}
                disabled={pending}
                className="rounded-lg bg-status-danger px-3 py-1.5 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60"
              >
                Archive
              </button>
            </div>
          </div>
        </div>
      )}
    </Card>
  )
}
