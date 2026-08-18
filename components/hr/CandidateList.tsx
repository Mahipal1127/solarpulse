'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Badge, EmptyState } from '@/components/ui/primitives'
import { CANDIDATE_STATUSES } from '@/lib/hr/constants'
import {
  CANDIDATE_STATUS_LABELS,
  CANDIDATE_STATUS_STYLES,
  CANDIDATE_STATUS_ORDER,
  INTERVIEW_RESULT_LABELS,
  INTERVIEW_RESULT_STYLES,
  formatCandidateSource,
  formatInterviewRound,
  formatDateTime,
} from '@/lib/format'
import type { Candidate, CandidateStatus, Interview } from '@/lib/types'

interface CandidateWithInterviews extends Candidate {
  interviews: Interview[]
}

/**
 * The recruitment board. Each candidate shows their pipeline stage as an inline status
 * select (PATCH /api/candidates/[id]) and their interviews beneath. readOnly hides the
 * controls for a CEO viewing the module. A status filter sits on top.
 */
export function CandidateList({
  candidates,
  readOnly,
}: {
  candidates: CandidateWithInterviews[]
  readOnly: boolean
}) {
  const [filter, setFilter] = useState<string>('all')
  const filtered =
    filter === 'all' ? candidates : candidates.filter((c) => c.status === filter)

  if (candidates.length === 0) {
    return (
      <EmptyState
        title="No candidates yet"
        description="Candidates you add show up here with their interviews and stage."
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Chip label="All" active={filter === 'all'} onClick={() => setFilter('all')} />
        {CANDIDATE_STATUS_ORDER.map((s) => (
          <Chip
            key={s}
            label={CANDIDATE_STATUS_LABELS[s]}
            active={filter === s}
            onClick={() => setFilter(s)}
          />
        ))}
      </div>

      <div className="space-y-3">
        {filtered.map((c) => (
          <CandidateCard key={c.id} candidate={c} readOnly={readOnly} />
        ))}
      </div>
    </div>
  )
}

function CandidateCard({
  candidate,
  readOnly,
}: {
  candidate: CandidateWithInterviews
  readOnly: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<CandidateStatus>(candidate.status)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function changeStatus(next: CandidateStatus) {
    const prev = status
    setStatus(next)
    setPending(true)
    setError(null)
    const res = await fetch(`/api/candidates/${candidate.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })
    setPending(false)
    if (!res.ok) {
      setStatus(prev)
      const body = await res.json().catch(() => ({}))
      setError(body.error ?? 'Could not update status.')
      return
    }
    router.refresh()
  }

  return (
    <div className="rounded-2xl border border-border-subtle bg-surface-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-medium text-brand-slate">{candidate.name}</p>
          <p className="mt-0.5 text-xs text-text-muted">
            {candidate.applied_for_role ?? 'Role not set'} · {formatCandidateSource(candidate.source)}
          </p>
          <p className="mt-0.5 text-xs text-text-muted">
            {candidate.phone ?? '—'}
            {candidate.email ? ` · ${candidate.email}` : ''}
          </p>
        </div>

        {readOnly ? (
          <Badge className={CANDIDATE_STATUS_STYLES[status]}>
            {CANDIDATE_STATUS_LABELS[status]}
          </Badge>
        ) : (
          <select
            value={status}
            disabled={pending}
            onChange={(e) => changeStatus(e.target.value as CandidateStatus)}
            className="rounded-lg border border-border-subtle px-2 py-1 text-xs outline-none focus:border-brand-gold disabled:opacity-60"
          >
            {CANDIDATE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {CANDIDATE_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        )}
      </div>

      {candidate.interviews.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-border-subtle pt-3">
          {candidate.interviews.map((iv) => (
            <div key={iv.id} className="flex items-center justify-between gap-3 text-xs">
              <span className="text-text-muted">
                {formatInterviewRound(iv.round)}
                {iv.scheduled_date ? ` · ${formatDateTime(iv.scheduled_date)}` : ''}
              </span>
              <Badge className={INTERVIEW_RESULT_STYLES[iv.result]}>
                {INTERVIEW_RESULT_LABELS[iv.result]}
              </Badge>
            </div>
          ))}
        </div>
      )}

      {error && <p className="mt-2 text-xs text-status-danger">⚠ {error}</p>}
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? 'bg-brand-slate text-white'
          : 'border border-border-subtle text-text-muted hover:bg-surface-bg'
      }`}
    >
      {label}
    </button>
  )
}
