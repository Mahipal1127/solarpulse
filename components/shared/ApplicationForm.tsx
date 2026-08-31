'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { APPLICATION_RECIPIENT_LABELS } from '@/lib/format'
import type { ApplicationRecipient } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

const RECIPIENTS: readonly ApplicationRecipient[] = ['hr', 'ceo', 'both']

/**
 * Write a free-text application to HR, the CEO, or both. Open to every employee — the
 * server derives the author from the session, so this form never carries an employee id.
 * This is the general channel to management; time off goes through the dedicated leave
 * form instead.
 */
export function ApplicationForm() {
  const router = useRouter()
  const [recipient, setRecipient] = useState<ApplicationRecipient>('hr')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!subject.trim()) return setError('Add a subject.')
    if (!body.trim()) return setError('Write your application.')

    setPending(true)
    setError(null)

    const res = await fetch('/api/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient, subject: subject.trim(), body: body.trim() }),
    })

    const payload = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(payload.error ?? 'Could not submit the application.')
      return
    }

    setSubject('')
    setBody('')
    setRecipient('hr')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="a-recipient" className={labelClass}>
          Send to
        </label>
        <select
          id="a-recipient"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value as ApplicationRecipient)}
          className={inputClass}
        >
          {RECIPIENTS.map((r) => (
            <option key={r} value={r}>
              {APPLICATION_RECIPIENT_LABELS[r]}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="a-subject" className={labelClass}>
          Subject
        </label>
        <input
          id="a-subject"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          maxLength={200}
          placeholder="What is this about?"
          className={inputClass}
        />
      </div>

      <div>
        <label htmlFor="a-body" className={labelClass}>
          Application
        </label>
        <textarea
          id="a-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={6}
          maxLength={5000}
          placeholder="Write your application here."
          className={inputClass}
        />
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Submitting…' : 'Submit application'}
      </button>
    </div>
  )
}
