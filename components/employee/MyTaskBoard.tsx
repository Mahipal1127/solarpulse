'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { Badge } from '@/components/ui/primitives'
import { DelegateDialog, NewTaskDialog } from '@/components/shared/TaskDelegationDialogs'
import {
  formatDate,
  isOverdue,
  STATUS_STYLES,
  STATUS_LABELS,
  PRIORITY_STYLES,
  PRIORITY_LABELS,
} from '@/lib/format'
import type { Task } from '@/lib/types'

export type AssignedTask = Task & {
  department: { name: string } | null
  creator: { full_name: string } | null
}

type FormState = {
  status: 'pending' | 'in_progress' | 'completed'
  progress: number
  note: string
  saving: boolean
  error: string | null
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string
  value: number
  accent?: string
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`mt-1.5 text-3xl font-bold ${accent ?? 'text-brand-slate'}`}>{value}</p>
    </div>
  )
}

export function MyTaskBoard({
  initialTasks,
  userId,
}: {
  initialTasks: AssignedTask[]
  userId: string
}) {
  const [tasks, setTasks] = useState<AssignedTask[]>(initialTasks)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [forms, setForms] = useState<Record<string, FormState>>({})
  const [delegating, setDelegating] = useState<AssignedTask | null>(null)
  const [creating, setCreating] = useState(false)

  /*
   * Live updates: Supabase broadcasts the full new row on UPDATE so we can patch local
   * state without a round-trip. The subscription filter matches the assignee's own rows
   * (the ones this board can act on); an unclaimed task flipping to assigned arrives on
   * the next page load, which is fine — delegation is a manager action, not something
   * the assignee is staring at the board waiting for.
   */
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('my-assigned-tasks')
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'tasks', filter: `assigned_user_id=eq.${userId}` },
        (payload) => {
          setTasks((prev) =>
            prev.map((t) => (t.id === payload.new.id ? { ...t, ...(payload.new as AssignedTask) } : t))
          )
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [userId])

  const openForm = useCallback((task: AssignedTask) => {
    setExpanded(task.id)
    setForms((prev) => ({
      ...prev,
      [task.id]: {
        status: (task.status as FormState['status']) ?? 'pending',
        progress: task.progress_percent ?? 0,
        note: '',
        saving: false,
        error: null,
      },
    }))
  }, [])

  async function save(taskId: string) {
    const form = forms[taskId]
    if (!form) return
    const snapshot = tasks.find((t) => t.id === taskId)

    setForms((prev) => ({ ...prev, [taskId]: { ...prev[taskId], saving: true, error: null } }))
    // Optimistic update
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, status: form.status as Task['status'], progress_percent: form.progress } : t
      )
    )

    const res = await fetch(`/api/tasks/${taskId}/progress`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: form.status, progress_percent: form.progress, note: form.note || undefined }),
    })

    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      if (snapshot) setTasks((prev) => prev.map((t) => (t.id === taskId ? snapshot : t)))
      setForms((prev) => ({ ...prev, [taskId]: { ...prev[taskId], saving: false, error: body.error ?? 'Save failed.' } }))
      return
    }

    const { task } = await res.json()
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, ...task } : t)))
    setForms((prev) => ({ ...prev, [taskId]: { ...prev[taskId], saving: false } }))
    setExpanded(null)
  }

  const active = tasks.filter((t) => t.status !== 'archived')
  const stats = {
    total: active.length,
    pending: active.filter((t) => t.status === 'pending').length,
    inProgress: active.filter((t) => t.status === 'in_progress').length,
    overdue: active.filter((t) => isOverdue(t)).length,
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Assigned" value={stats.total} />
        <StatCard label="Pending" value={stats.pending} />
        <StatCard label="In Progress" value={stats.inProgress} accent="text-status-info" />
        <StatCard label="Overdue" value={stats.overdue} accent={stats.overdue > 0 ? 'text-status-danger' : undefined} />
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-text-muted">
          Raise a requirement or forward work onward — every move stays connected to its original task.
        </p>
        <button
          onClick={() => setCreating(true)}
          className="shrink-0 rounded-lg bg-brand-gold px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-brand-orange"
        >
          + New task
        </button>
      </div>

      {active.length === 0 ? (
        <div className="rounded-xl border border-border-subtle bg-white px-6 py-16 text-center">
          <p className="text-sm font-medium text-text-muted">No tasks assigned to you yet.</p>
          <p className="mt-1 text-xs text-text-muted/60">
            The CEO assigns tasks through the CEO module — yours, and your department&apos;s
            shared queue, will appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {active.map((task) => {
            const over = isOverdue(task)
            const isOpen = expanded === task.id
            const form = forms[task.id]

            return (
              <div
                key={task.id}
                className={`overflow-hidden rounded-xl border bg-white shadow-sm transition-all ${over ? 'border-status-danger/25' : 'border-border-subtle'
                  }`}
              >
                <div className="px-5 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-brand-slate">{task.title}</h3>
                        {task.assigned_user_id === null && (
                          <Badge className="bg-surface-bg text-text-muted ring-border-subtle">Unassigned</Badge>
                        )}
                        {over && (
                          <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/30">Overdue</Badge>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={PRIORITY_STYLES[task.priority]}>
                          {PRIORITY_LABELS[task.priority]}
                        </Badge>
                        <Badge className={STATUS_STYLES[task.status]}>
                          {STATUS_LABELS[task.status]}
                        </Badge>
                        {task.department && (
                          <span className="text-xs text-text-muted">· {task.department.name}</span>
                        )}
                        {task.due_date && (
                          <span className={`text-xs ${over ? 'font-medium text-status-danger' : 'text-text-muted'}`}>
                            · Due {formatDate(task.due_date)}
                          </span>
                        )}
                        {task.creator && (
                          <span className="text-xs text-text-muted/60">
                            · by {task.creator.full_name}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2 pt-0.5">
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-bg">
                          <div
                            className="h-full rounded-full bg-brand-gold transition-all duration-500"
                            style={{ width: `${task.progress_percent ?? 0}%` }}
                          />
                        </div>
                        <span className="w-8 shrink-0 text-right text-xs font-semibold text-text-muted">
                          {task.progress_percent ?? 0}%
                        </span>
                      </div>
                    </div>

                    {/*
                      Only the task's own assignee can progress it — updateTaskProgress
                      rejects everyone else (403), so the control is hidden rather than
                      left to fail. An unclaimed department task ("Unassigned") is shown
                      read-only: delegation to a person is the manager's move, from the
                      team tab.
                    */}
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/task-flow/${task.id}`}
                        className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
                      >
                        Flow
                      </Link>
                      {task.status !== 'completed' && (
                        <button
                          onClick={() => setDelegating(task)}
                          className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
                        >
                          Delegate
                        </button>
                      )}
                      {task.status !== 'completed' && task.assigned_user_id === userId && (
                        <button
                          onClick={() => (isOpen ? setExpanded(null) : openForm(task))}
                          className="rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-brand-orange"
                        >
                          {isOpen ? 'Cancel' : 'Update'}
                        </button>
                      )}
                      {task.status !== 'completed' && task.assigned_user_id !== userId && (
                        <span className="text-xs text-text-muted/60">Awaiting delegation</span>
                      )}
                    </div>
                  </div>
                </div>

                {isOpen && form && (
                  <div className="border-t border-border-subtle bg-surface-bg px-5 py-4">
                    <div className="space-y-4">
                      <div className="flex flex-wrap gap-6">
                        <div>
                          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                            Status
                          </label>
                          <select
                            value={form.status}
                            onChange={(e) =>
                              setForms((p) => ({
                                ...p,
                                [task.id]: { ...p[task.id], status: e.target.value as FormState['status'] },
                              }))
                            }
                            className="rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none focus:border-brand-gold"
                          >
                            <option value="pending">Pending</option>
                            <option value="in_progress">In Progress</option>
                            <option value="completed">Completed</option>
                          </select>
                        </div>

                        <div className="min-w-[200px] flex-1">
                          <div className="mb-1.5 flex items-center justify-between">
                            <label className="text-xs font-semibold uppercase tracking-wide text-text-muted">
                              Progress
                            </label>
                            <span className="text-xs font-bold text-brand-slate">{form.progress}%</span>
                          </div>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            step={5}
                            value={form.progress}
                            onChange={(e) =>
                              setForms((p) => ({
                                ...p,
                                [task.id]: { ...p[task.id], progress: Number(e.target.value) },
                              }))
                            }
                            className="w-full accent-brand-gold"
                          />
                        </div>
                      </div>

                      <div>
                        <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted">
                          Note{' '}
                          <span className="font-normal normal-case tracking-normal text-text-muted/60">
                            (optional — logged in task history)
                          </span>
                        </label>
                        <textarea
                          rows={2}
                          placeholder="What did you complete? Any blockers?"
                          value={form.note}
                          onChange={(e) =>
                            setForms((p) => ({
                              ...p,
                              [task.id]: { ...p[task.id], note: e.target.value },
                            }))
                          }
                          className="w-full resize-none rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none placeholder:text-text-muted/60 focus:border-brand-gold"
                        />
                      </div>

                      {form.error && (
                        <p className="text-xs font-medium text-status-danger">⚠ {form.error}</p>
                      )}

                      <div className="flex gap-2">
                        <button
                          onClick={() => save(task.id)}
                          disabled={form.saving}
                          className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
                        >
                          {form.saving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setExpanded(null)}
                          disabled={form.saving}
                          className="rounded-lg border border-border-subtle px-4 py-2 text-sm text-text-muted hover:bg-surface-bg disabled:opacity-60"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {delegating && (
        <DelegateDialog
          taskId={delegating.id}
          taskTitle={delegating.title}
          onClose={() => setDelegating(null)}
        />
      )}

      {creating && <NewTaskDialog onClose={() => setCreating(false)} />}
    </div>
  )
}
