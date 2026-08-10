'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { MapPin, Plane, CalendarClock, AlertTriangle, FileText } from 'lucide-react'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import {
  formatDate,
  formatDateTime,
  isSurveyOverdue,
  isSurveyAwaitingSchedule,
  SURVEY_STATUS_STYLES,
  SURVEY_STATUS_LABELS,
} from '@/lib/format'
import { pillClass } from '@/components/shared/chrome'
import type { SiteSurvey, SurveyStatus } from '@/lib/types'

export type SurveyRow = SiteSurvey & {
  engineer: { full_name: string } | null
  lead: { name: string } | null
}

const STATUS_FILTERS: (SurveyStatus | 'all')[] = [
  'all',
  'assigned',
  'in_progress',
  'completed',
  'cancelled',
]

export function SurveyList({
  surveys,
  currentUserId,
  readOnly,
  /** A Technical lead sees everyone's surveys, so the "mine only" filter is worth offering. */
  showOwnerFilter = false,
}: {
  surveys: SurveyRow[]
  currentUserId: string
  readOnly: boolean
  showOwnerFilter?: boolean
}) {
  const [status, setStatus] = useState<SurveyStatus | 'all'>('all')
  const [mineOnly, setMineOnly] = useState(false)
  const [search, setSearch] = useState('')

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return surveys.filter((survey) => {
      if (status !== 'all' && survey.status !== status) return false
      if (mineOnly && survey.assigned_engineer_id !== currentUserId) return false
      if (!term) return true
      return (
        (survey.lead?.name ?? '').toLowerCase().includes(term) ||
        (survey.engineer?.full_name ?? '').toLowerCase().includes(term) ||
        (survey.notes ?? '').toLowerCase().includes(term)
      )
    })
  }, [surveys, status, mineOnly, currentUserId, search])

  return (
    <Card>
      <CardHeader
        title="Site Surveys"
        subtitle={`${visible.length} of ${surveys.length} shown`}
        action={
          !readOnly && (
            <Link
              href="/technical/surveys/new"
              className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
            >
              Log survey
            </Link>
          )
        }
      />

      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle bg-surface-bg px-5 py-3">
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((option) => (
            <button
              key={option}
              onClick={() => setStatus(option)}
              className={pillClass(status === option)}
            >
              {option === 'all' ? 'All' : SURVEY_STATUS_LABELS[option]}
            </button>
          ))}
        </div>

        {showOwnerFilter && (
          <label className="flex items-center gap-2 text-xs font-medium text-text-muted">
            <input
              type="checkbox"
              checked={mineOnly}
              onChange={(e) => setMineOnly(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border-subtle text-brand-slate "
            />
            Assigned to me
          </label>
        )}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search lead, engineer, notes"
          aria-label="Search surveys"
          className="ml-auto w-56 rounded-lg border border-border-subtle px-3 py-1.5 text-sm outline-none focus:border-brand-gold"
        />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          title="No surveys match"
          description={
            surveys.length === 0
              ? 'Surveys arrive from a Sales site visit request, or you can log one directly.'
              : 'Try a different status or clear the search.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {visible.map((survey) => {
            const awaiting = isSurveyAwaitingSchedule(survey)
            const overdue = isSurveyOverdue(survey)

            return (
              <li key={survey.id}>
                <Link
                  href={`/technical/surveys/${survey.id}`}
                  className="flex items-start justify-between gap-4 px-5 py-4 transition-colors hover:bg-surface-bg"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-brand-slate">
                        {survey.lead?.name ?? 'No lead linked'}
                      </p>
                      <Badge className={SURVEY_STATUS_STYLES[survey.status]}>
                        {SURVEY_STATUS_LABELS[survey.status]}
                      </Badge>
                      {survey.is_drone_survey && (
                        <Badge className="bg-status-info/10 text-status-info ring-status-info/25">
                          <Plane className="mr-1 h-3 w-3" />
                          Drone
                        </Badge>
                      )}
                      {/* The handoff point the client flagged: Sales asked, nobody
                          has put a date on it. Loudest thing in the row. */}
                      {awaiting && (
                        <Badge className="bg-status-warning/10 text-status-warning ring-status-warning/25">
                          <CalendarClock className="mr-1 h-3 w-3" />
                          Needs a date
                        </Badge>
                      )}
                      {overdue && (
                        <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/25">
                          <AlertTriangle className="mr-1 h-3 w-3" />
                          Overdue
                        </Badge>
                      )}
                    </div>

                    <p className="mt-1 text-xs text-text-muted">
                      {survey.engineer?.full_name ?? 'Unassigned'}
                      {' · '}
                      {survey.scheduled_date
                        ? `Scheduled ${formatDateTime(survey.scheduled_date)}`
                        : 'No date set'}
                      {survey.site_visit_request_id && ' · From Sales request'}
                    </p>

                    {survey.notes && (
                      <p className="mt-1 line-clamp-1 text-xs text-text-muted">{survey.notes}</p>
                    )}
                  </div>

                  <div className="shrink-0 text-right">
                    {/* What has actually been captured, at a glance: a location pin
                        and a bill. Each icon is tied to the field it reports, so a
                        survey with a bill but no GPS still shows the one it has. */}
                    <div className="flex items-center justify-end gap-1.5 text-text-muted/60">
                      {survey.gps_latitude !== null && (
                        <MapPin className="h-3.5 w-3.5" aria-label="Location recorded" />
                      )}
                      {survey.electricity_bill_file_path && (
                        <FileText className="h-3.5 w-3.5" aria-label="Electricity bill attached" />
                      )}
                    </div>
                    <p className="mt-1 text-xs text-text-muted/60">{formatDate(survey.created_at)}</p>
                  </div>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
