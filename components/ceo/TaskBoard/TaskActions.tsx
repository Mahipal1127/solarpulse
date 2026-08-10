'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardHeader } from '@/components/ui/primitives'
import type { Task, TaskStatus } from '@/lib/types'

const inputClass =
  'mt-1 w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'

export function TaskActions({ task }: { task: Task }) {
  const router = useRouter()
  const [status, setStatus] = useState<TaskStatus>(task.status)
  const [progress, setProgress] = useState(task.progress_percent)
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmArchive, setConfirmArchive] = useState(false)

  async function save() {
    setPending(true)
    setError(null)

    const res = await fetch(`/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status,
        progress_percent: progress,
        ...(note.trim() ? { note: note.trim() } : {}),
      }),
    })

    setPending(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update the task.')
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
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not archive the task.')
      return
    }
    router.refresh()
  }

  return (
    <Card>
      <CardHeader title="Post update" subtitle="Appends to the progress timeline" />
      <div className="space-y-4 px-5 py-4">
        <div>
          <label htmlFor="status" className="block text-sm font-medium text-text-muted">
            Status
          </label>
          <select
            id="status"
            value={status}
            onChange={(e) => setStatus(e.target.value as TaskStatus)}
            className={inputClass}
          >
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="delayed">Delayed</option>
            <option value="completed">Completed</option>
          </select>
        </div>

        <div>
          <label htmlFor="progress" className="block text-sm font-medium text-text-muted">
            Progress: {progress}%
          </label>
          <input
            id="progress"
            type="range"
            min={0}
            max={100}
            step={5}
            value={progress}
            onChange={(e) => setProgress(Number(e.target.value))}
            className="mt-2 w-full"
          />
        </div>

        <div>
          <label htmlFor="note" className="block text-sm font-medium text-text-muted">
            Note
          </label>
          <textarea
            id="note"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className={inputClass}
            placeholder="What changed?"
          />
        </div>

        {error && <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-xs text-status-danger">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            onClick={save}
            disabled={pending || task.status === 'archived'}
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white hover:bg-brand-orange disabled:opacity-60"
          >
            {pending ? 'Saving…' : 'Save update'}
          </button>

          {task.status !== 'archived' && (
            <button
              onClick={() => setConfirmArchive(true)}
              disabled={pending}
              className="rounded-lg border border-border-subtle px-4 py-2 text-sm font-medium text-text-muted hover:bg-surface-bg disabled:opacity-60"
            >
              Archive
            </button>
          )}
        </div>
      </div>

      {confirmArchive && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-brand-slate/50 px-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-lg">
            <h3 className="text-sm font-semibold text-brand-slate">Archive this task?</h3>
            <p className="mt-2 text-sm text-text-muted">
              It will be hidden from the default task list. The record is kept and can still be
              found by filtering for archived tasks.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setConfirmArchive(false)}
                className="rounded-lg border border-border-subtle px-3 py-1.5 text-sm text-text-muted hover:bg-surface-bg"
              >
                Cancel
              </button>
              <button
                onClick={archive}
                disabled={pending}
                className="rounded-lg bg-status-danger px-3 py-1.5 text-sm font-medium text-white hover:bg-status-danger disabled:opacity-60"
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
