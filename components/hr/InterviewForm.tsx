'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { INTERVIEW_ROUNDS } from '@/lib/hr/constants'
import { INTERVIEW_ROUND_LABELS } from '@/lib/format'
import type { InterviewRound } from '@/lib/types'

const inputClass =
  'w-full rounded-lg border border-border-subtle px-3 py-2 text-sm outline-none focus:border-brand-gold'
const labelClass = 'mb-1 block text-xs font-semibold uppercase tracking-wide text-text-muted'

/**
 * Schedules an interview against an existing candidate. The candidate and interviewer
 * pickers are populated by the recruitment page; the datetime is converted to an ISO
 * string for the API (which expects z.string().datetime()).
 */
export function InterviewForm({
  candidates,
  interviewers,
}: {
  candidates: { id: string; name: string }[]
  interviewers: { id: string; full_name: string }[]
}) {
  const router = useRouter()
  const [candidateId, setCandidateId] = useState('')
  const [interviewerId, setInterviewerId] = useState('')
  const [round, setRound] = useState<InterviewRound | ''>('')
  const [when, setWhen] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!candidateId) return setError('Select a candidate.')
    setPending(true)
    setError(null)

    const res = await fetch('/api/interviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        candidate_id: candidateId,
        interviewer_id: interviewerId || null,
        round: round || null,
        scheduled_date: when ? new Date(when).toISOString() : null,
      }),
    })

    const body = await res.json().catch(() => ({}))
    setPending(false)
    if (!res.ok) {
      setError(body.error ?? 'Could not schedule the interview.')
      return
    }

    setCandidateId('')
    setInterviewerId('')
    setRound('')
    setWhen('')
    router.refresh()
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="iv-cand" className={labelClass}>
            Candidate
          </label>
          <select
            id="iv-cand"
            value={candidateId}
            onChange={(e) => setCandidateId(e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="iv-round" className={labelClass}>
            Round
          </label>
          <select
            id="iv-round"
            value={round}
            onChange={(e) => setRound(e.target.value as InterviewRound | '')}
            className={inputClass}
          >
            <option value="">—</option>
            {INTERVIEW_ROUNDS.map((r) => (
              <option key={r} value={r}>
                {INTERVIEW_ROUND_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="iv-interviewer" className={labelClass}>
            Interviewer
          </label>
          <select
            id="iv-interviewer"
            value={interviewerId}
            onChange={(e) => setInterviewerId(e.target.value)}
            className={inputClass}
          >
            <option value="">—</option>
            {interviewers.map((u) => (
              <option key={u.id} value={u.id}>
                {u.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="iv-when" className={labelClass}>
            Scheduled for
          </label>
          <input
            id="iv-when"
            type="datetime-local"
            value={when}
            onChange={(e) => setWhen(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>

      {error && <p className="text-xs text-status-danger">⚠ {error}</p>}

      <button
        onClick={save}
        disabled={pending}
        className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange disabled:opacity-60"
      >
        {pending ? 'Scheduling…' : 'Schedule interview'}
      </button>
    </div>
  )
}
