'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { EXIT_TYPES } from '@/lib/hr/constants'
import { EXIT_TYPE_LABELS } from '@/lib/format'
import type { ExitType } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Processes an employee exit — HR-lead / CEO only. This is destructive and hard to
 * reverse: it records the exit, marks the employee 'exited', AND deactivates their
 * login, all in one transaction. So it is gated behind an explicit expand + a typed
 * confirmation, not a bare button. The server enforces the same permission; this is the
 * UX guard.
 */
export function ExitControl({
  employeeId,
  employeeName,
}: {
  employeeId: string
  employeeName: string
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [exitDate, setExitDate] = useState('')
  const [exitType, setExitType] = useState<ExitType | ''>('')
  const [reason, setReason] = useState('')
  const [confirmName, setConfirmName] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    if (!exitDate) return setError('Pick an exit date.')
    if (confirmName.trim() !== employeeName) {
      return setError(`Type "${employeeName}" to confirm — this deactivates their account.`)
    }

    setPending(true)
    setError(null)

    const res = await fetch(`/api/employees/${employeeId}/exit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        exit_date: exitDate,
        exit_type: exitType || null,
        reason: reason.trim() || null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not process the exit.')
      return
    }

    setOpen(false)
    router.refresh()
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg border border-status-danger px-3 py-1.5 text-xs font-medium text-status-danger transition-colors hover:bg-status-danger/10"
      >
        Process exit
      </button>
    )
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-status-danger/40 bg-status-danger/5 px-4 py-3">
      <p className="text-xs font-medium text-status-danger">
        Processing an exit deactivates {employeeName}&apos;s login and marks them exited. This cannot
        be undone from here.
      </p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className={labelClass}>Exit date</label>
          <input
            type="date"
            value={exitDate}
            onChange={(e) => setExitDate(e.target.value)}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>Exit type</label>
          <select
            value={exitType}
            onChange={(e) => setExitType(e.target.value as ExitType | '')}
            className={inputClass}
          >
            <option value="">—</option>
            {EXIT_TYPES.map((t) => (
              <option key={t} value={t}>
                {EXIT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className={labelClass}>Reason (optional)</label>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className={inputClass}
        />
      </div>

      <div>
        <label className={labelClass}>
          Type &quot;{employeeName}&quot; to confirm
        </label>
        <input
          value={confirmName}
          onChange={(e) => setConfirmName(e.target.value)}
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <div className="flex gap-2">
        <button
          onClick={submit}
          disabled={pending}
          className="rounded-lg bg-status-danger px-3 py-1.5 text-xs font-medium text-white transition-colors hover:opacity-90 disabled:opacity-60"
        >
          {pending ? 'Processing…' : 'Confirm exit'}
        </button>
        <button
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-text-muted transition-colors hover:bg-surface-bg"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
