'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { X } from 'lucide-react'
import { TaskFlowTimeline } from '@/components/shared/TaskFlowTimeline'
import type { TaskFlow } from '@/lib/types'
import type { DelegationTargets } from '@/lib/services/tasks'

/**
 * The employee/manager side of delegation, as dialogs the task boards open.
 *
 * THREE SURFACES, ONE FILE
 *   * DelegateDialog  — per-card: shows the task's chain so far, and offers the
 *     two moves — raise a sub-task / requirement, or forward the whole task to
 *     another person or department.
 *   * NewTaskDialog   — originate a top-level task. A manager may aim it at any
 *     department; an employee's creation lands in their own department, because
 *     a cross-department ask without a parent task has no owner to trace it
 *     back to. The rules live server-side in createTask; the dialog only
 *     reflects what the targets endpoint says the caller may do.
 *
 * PRIVILEGED WRITES, HONEST ERRORS
 * Both forms post to the privileged endpoints and print the server's message on
 * failure — "You can only delegate from tasks assigned to you" is the rule
 * speaking, and a generic "something went wrong" would hide it.
 */

const inputClass =
  'w-full rounded-lg border border-border-subtle bg-white px-3 py-2 text-sm outline-none placeholder:text-text-muted/60 focus:border-brand-gold'
const labelClass = 'mb-1.5 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/** Department + optional person, the addressing pair every form shares. */
function AssignFields({
  targets,
  departmentId,
  personId,
  onDepartment,
  onPerson,
}: {
  targets: DelegationTargets
  departmentId: string
  personId: string
  onDepartment: (id: string) => void
  onPerson: (id: string) => void
}) {
  const people = targets.people.filter((p) => p.department_id === departmentId)

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <div>
        <label className={labelClass}>Department</label>
        <select value={departmentId} onChange={(e) => onDepartment(e.target.value)} className={inputClass}>
          <option value="">Choose…</option>
          {targets.departments.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className={labelClass}>
          Person <span className="font-normal normal-case tracking-normal text-text-muted/60">(optional)</span>
        </label>
        <select value={personId} onChange={(e) => onPerson(e.target.value)} className={inputClass}>
          <option value="">Whole department</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.full_name}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}

function DialogShell({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string
  subtitle: string
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-surface-card p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-brand-slate">{title}</h2>
            <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-surface-bg hover:text-brand-slate"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

async function postJson(url: string, body: unknown): Promise<{ ok: true } | { ok: false; error: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (res.ok) return { ok: true }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  return { ok: false, error: data.error ?? 'Something went wrong. Try again.' }
}

/** Shared loader: the address book plus the chain so far, both on open. */
function useDelegationData(taskId: string | null) {
  const [targets, setTargets] = useState<DelegationTargets | null>(null)
  const [flow, setFlow] = useState<TaskFlow | null>(null)

  useEffect(() => {
    if (!taskId) return
    let cancelled = false
    void (async () => {
      const [targetsRes, flowRes] = await Promise.all([
        fetch('/api/tasks/delegation-targets'),
        fetch(`/api/tasks/${taskId}/flow`),
      ])
      if (cancelled) return
      if (targetsRes.ok) setTargets((await targetsRes.json()) as DelegationTargets)
      if (flowRes.ok) {
        const { flow } = (await flowRes.json()) as { flow: TaskFlow }
        setFlow(flow)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [taskId])

  return { targets, flow }
}

/**
 * Per-task delegation: the chain so far, then the two moves. Sub-task raises a
 * new requirement wired into this task's chain; forward hands the whole open
 * task to someone else. Both write through the privileged endpoints, so the
 * server's rule messages surface verbatim on failure.
 */
export function DelegateDialog({
  taskId,
  taskTitle,
  canForward = true,
  onClose,
}: {
  taskId: string
  taskTitle: string
  /** Completed/archived tasks cannot be forwarded — the caller knows the task's status. */
  canForward?: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const { targets, flow } = useDelegationData(taskId)
  const [mode, setMode] = useState<'subtask' | 'forward'>('subtask')

  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [personId, setPersonId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function resetForm() {
    setTitle('')
    setDescription('')
    setPriority('medium')
    setDueDate('')
    setDepartmentId('')
    setPersonId('')
    setNote('')
    setError(null)
  }

  async function submitSubTask() {
    if (!title.trim() || !departmentId) {
      setError('Give the requirement a title and choose a department.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await postJson(`/api/tasks/${taskId}/subtasks`, {
      title,
      description: description || undefined,
      priority,
      due_date: dueDate ? new Date(`${dueDate}T09:00:00`).toISOString() : undefined,
      assigned_department_id: departmentId,
      assigned_user_id: personId || undefined,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    resetForm()
    onClose()
    router.refresh()
  }

  async function submitForward() {
    if (!departmentId) {
      setError('Choose a department or person to forward to.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await postJson(`/api/tasks/${taskId}/forward`, {
      assigned_department_id: departmentId,
      assigned_user_id: personId || undefined,
      note: note || undefined,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    resetForm()
    onClose()
    router.refresh()
  }

  return (
    <DialogShell
      title="Delegate"
      subtitle={taskTitle}
      onClose={onClose}
    >
      {canForward && (
        <div className="mb-4 inline-flex rounded-lg border border-border-subtle bg-surface-bg p-0.5">
          {(
            [
              ['subtask', 'Create sub-task'],
              ['forward', 'Forward task'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              onClick={() => {
                setMode(value)
                setError(null)
              }}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                mode === value ? 'bg-surface-card text-brand-slate shadow-sm' : 'text-text-muted hover:text-brand-slate'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {flow && flow.nodes.length > 1 && (
        <div className="mb-4 rounded-xl border border-border-subtle bg-surface-bg p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-muted">The chain so far</p>
          <TaskFlowTimeline flow={flow} compact />
        </div>
      )}

      {mode === 'subtask' ? (
        <div className="space-y-3">
          <div>
            <label className={labelClass}>What is needed</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Deliver 1 additional solar panel to the site"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>
              Details <span className="font-normal normal-case tracking-normal text-text-muted/60">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Why this is needed, and anything the receiver should know."
              className={`${inputClass} resize-none`}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Priority</label>
              <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>
                Due <span className="font-normal normal-case tracking-normal text-text-muted/60">(optional)</span>
              </label>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
            </div>
          </div>
          {targets && (
            <AssignFields
              targets={targets}
              departmentId={departmentId}
              personId={personId}
              onDepartment={setDepartmentId}
              onPerson={setPersonId}
            />
          )}
          {error && <p className="text-xs font-medium text-status-danger">⚠ {error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={submitSubTask}
              disabled={busy}
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
            >
              {busy ? 'Sending…' : 'Raise requirement'}
            </button>
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-border-subtle px-4 py-2 text-sm text-text-muted hover:bg-surface-bg disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="rounded-xl bg-surface-bg px-4 py-3 text-xs leading-relaxed text-text-muted">
            Forwarding hands the whole task to someone else. It stays part of this
            chain — the original department keeps ownership and can follow it.
          </p>
          {targets && (
            <AssignFields
              targets={targets}
              departmentId={departmentId}
              personId={personId}
              onDepartment={setDepartmentId}
              onPerson={setPersonId}
            />
          )}
          <div>
            <label className={labelClass}>
              Note <span className="font-normal normal-case tracking-normal text-text-muted/60">(optional)</span>
            </label>
            <textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Why it is being forwarded."
              className={`${inputClass} resize-none`}
            />
          </div>
          {error && <p className="text-xs font-medium text-status-danger">⚠ {error}</p>}
          <div className="flex gap-2 pt-1">
            <button
              onClick={submitForward}
              disabled={busy}
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
            >
              {busy ? 'Forwarding…' : 'Forward'}
            </button>
            <button
              onClick={onClose}
              disabled={busy}
              className="rounded-lg border border-border-subtle px-4 py-2 text-sm text-text-muted hover:bg-surface-bg disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </DialogShell>
  )
}

/**
 * Originate a top-level task. A manager may point it at any department; an
 * employee's creation lands in their own department (the server enforces this —
 * the dialog merely reflects what the targets endpoint reports).
 */
export function NewTaskDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter()
  const [targets, setTargets] = useState<DelegationTargets | null>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState('medium')
  const [dueDate, setDueDate] = useState('')
  const [departmentId, setDepartmentId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await fetch('/api/tasks/delegation-targets')
      if (!res.ok || cancelled) return
      const data = (await res.json()) as DelegationTargets
      if (cancelled) return
      setTargets(data)
      setDepartmentId(data.canAssignAnyDepartment ? '' : (data.ownDepartmentId ?? ''))
    })()
    return () => {
      cancelled = true
    }
  }, [])

  async function submit() {
    if (!title.trim() || !departmentId) {
      setError('Give the task a title and choose a department.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await postJson('/api/tasks', {
      title,
      description: description || undefined,
      priority,
      due_date: dueDate ? new Date(`${dueDate}T09:00:00`).toISOString() : undefined,
      assigned_department_id: departmentId,
    })
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <DialogShell
      title="New task"
      subtitle="Lands in the chosen department's queue for its manager to delegate."
      onClose={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className={labelClass}>Title</label>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="What needs to happen"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>
            Details <span className="font-normal normal-case tracking-normal text-text-muted/60">(optional)</span>
          </label>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className={`${inputClass} resize-none`}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelClass}>Priority</label>
            <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputClass}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
          </div>
          <div>
            <label className={labelClass}>
              Due <span className="font-normal normal-case tracking-normal text-text-muted/60">(optional)</span>
            </label>
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </div>
        </div>
        <div>
          <label className={labelClass}>Department</label>
          {targets && !targets.canAssignAnyDepartment ? (
            <input
              value={targets.departments.find((d) => d.id === targets.ownDepartmentId)?.name ?? 'Your department'}
              readOnly
              className={`${inputClass} bg-surface-bg text-text-muted`}
            />
          ) : (
            <select value={departmentId} onChange={(e) => setDepartmentId(e.target.value)} className={inputClass}>
              <option value="">Choose…</option>
              {targets?.departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {error && <p className="text-xs font-medium text-status-danger">⚠ {error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            onClick={submit}
            disabled={busy}
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
          >
            {busy ? 'Creating…' : 'Create task'}
          </button>
          <button
            onClick={onClose}
            disabled={busy}
            className="rounded-lg border border-border-subtle px-4 py-2 text-sm text-text-muted hover:bg-surface-bg disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    </DialogShell>
  )
}