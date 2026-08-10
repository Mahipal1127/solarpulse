'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Check, PencilRuler } from 'lucide-react'
import { Badge } from '@/components/ui/primitives'
import { SURVEY_STATUS_STYLES, SURVEY_STATUS_LABELS } from '@/lib/format'
import { SURVEY_TRANSITIONS, SURVEY_STATUS_ORDER } from '@/lib/technical/constants'
import type { SiteSurvey, SurveyStatus } from '@/lib/types'

/**
 * The survey status rail, its move buttons, and the Design handoff.
 *
 * The handoff is the part worth reading. Completing a survey does not create a
 * design, move the survey into a design state, or navigate anywhere on its own —
 * it surfaces a "Start Design" button and stops. The build spec asks for a prompt
 * rather than a transition, and it is the right shape: a completed survey is a
 * finished record, and not every survey becomes a design (a roof may turn out to be
 * unsuitable). An automatic transition would fabricate a draft design for those and
 * leave someone deleting it.
 *
 * Hiding a button is courtesy, not enforcement. SURVEY_TRANSITIONS decides what is
 * offered here, the service layer asserts the same table server-side, and RLS
 * decides whether this user may touch the row at all.
 */
export function SurveyStatusTracker({
  survey,
  canOperate,
  existingDesignId,
}: {
  survey: SiteSurvey
  /** False for the CEO and anyone else reading another department's module. */
  canOperate: boolean
  /**
   * Set when a design already exists for this survey, which turns "Start Design"
   * into a link to it. Offering to start a second one is how a survey ends up with
   * two competing BOQs.
   */
  existingDesignId?: string | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState<SurveyStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<SurveyStatus | null>(null)

  const status = survey.status
  const cancelled = status === 'cancelled'
  const moves = SURVEY_TRANSITIONS[status] ?? []

  async function move(next: SurveyStatus) {
    setBusy(next)
    setError(null)

    const res = await fetch(`/api/surveys/${survey.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: next }),
    })

    const body = await res.json().catch(() => ({}))
    setBusy(null)

    if (!res.ok) {
      setError(body.error ?? 'Could not update the survey.')
      return
    }

    setConfirming(null)
    router.refresh()
  }

  const currentIndex = SURVEY_STATUS_ORDER.indexOf(status)

  return (
    <div className="space-y-4">
      {/* Cancelled is not a step on the rail — a cancelled survey left the path
          rather than advancing along it — so it reads as a banner instead. */}
      {cancelled ? (
        <div className="rounded-lg border border-status-danger/25 bg-status-danger/5 px-4 py-3">
          <p className="text-sm font-medium text-status-danger">This survey was cancelled.</p>
        </div>
      ) : (
        <ol className="flex flex-wrap items-center gap-1.5">
          {SURVEY_STATUS_ORDER.map((step, index) => {
            const done = index < currentIndex
            const current = index === currentIndex
            return (
              <li key={step} className="flex items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
                    current
                      ? SURVEY_STATUS_STYLES[step]
                      : done
                        ? 'bg-status-success/5 text-status-success ring-status-success/15'
                        : 'bg-surface-bg text-text-muted/60 ring-border-subtle'
                  }`}
                >
                  {done && <Check className="h-3 w-3" />}
                  {SURVEY_STATUS_LABELS[step]}
                </span>
                {index < SURVEY_STATUS_ORDER.length - 1 && (
                  <span
                    className={`h-px w-4 ${index < currentIndex ? 'bg-status-success/60' : 'bg-surface-bg'}`}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}

      <Badge className={SURVEY_STATUS_STYLES[status]}>{SURVEY_STATUS_LABELS[status]}</Badge>

      {error && <p className="rounded-lg bg-status-danger/5 px-3 py-2 text-sm text-status-danger">⚠ {error}</p>}

      {/*
        The prompt, not a transition. Shown to anyone who can read the survey,
        including the CEO — the button is a link to a form, and that form does its
        own guarding.
      */}
      {status === 'completed' && (
        <div className="rounded-lg border border-status-info/25 bg-status-info/5 p-4">
          {existingDesignId ? (
            <>
              <p className="text-sm text-status-info">
                This survey already has a design. A revision is a new design rather than an edit to
                a delivered one, so open the existing one first.
              </p>
              <Link
                href={`/technical/designs/${existingDesignId}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-status-info/30 bg-white px-4 py-2 text-sm font-semibold text-status-info transition-colors hover:bg-status-info/10"
              >
                <PencilRuler className="h-4 w-4" />
                Open the design
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-status-info">
                The survey is done. Designing from it is the next step, but not an automatic one —
                a roof that turns out to be unsuitable is a completed survey with no design.
              </p>
              {canOperate && (
                <Link
                  href={`/technical/designs/new?surveyId=${survey.id}`}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-status-info px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-status-info"
                >
                  <PencilRuler className="h-4 w-4" />
                  Start design
                </Link>
              )}
            </>
          )}
        </div>
      )}

      {canOperate && moves.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-muted">
            Move this survey
          </p>
          <div className="flex flex-wrap gap-2">
            {moves.map((next) => {
              const destructive = next === 'cancelled'
              const isConfirming = confirming === next

              if (destructive && isConfirming) {
                return (
                  <span key={next} className="flex items-center gap-2">
                    <button
                      onClick={() => move(next)}
                      disabled={busy !== null}
                      className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-status-danger disabled:opacity-60"
                    >
                      {busy === next ? 'Cancelling…' : 'Confirm cancel'}
                    </button>
                    <button
                      onClick={() => setConfirming(null)}
                      className="rounded-lg border border-border-subtle px-3 py-2 text-sm font-medium text-text-muted transition-colors hover:bg-surface-bg"
                    >
                      Keep it
                    </button>
                  </span>
                )
              }

              return (
                <button
                  key={next}
                  onClick={() => (destructive ? setConfirming(next) : move(next))}
                  disabled={busy !== null}
                  className={
                    destructive
                      ? 'rounded-lg border border-status-danger/25 px-4 py-2 text-sm font-medium text-status-danger transition-colors hover:bg-status-danger/5 disabled:opacity-60'
                      : 'rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange disabled:opacity-60'
                  }
                >
                  {busy === next ? 'Saving…' : `Mark ${SURVEY_STATUS_LABELS[next].toLowerCase()}`}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {canOperate && moves.length === 0 && status !== 'cancelled' && (
        <p className="text-xs text-text-muted">
          This survey is complete. Reopening is not a status change — a survey that turns out to be
          wrong gets a new survey, so both the original findings and the corrected ones survive.
        </p>
      )}
    </div>
  )
}
