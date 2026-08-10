import Link from 'next/link'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { Plane, AlertTriangle } from 'lucide-react'
import {
  formatDateTime,
  isSurveyOverdue,
  SURVEY_STATUS_STYLES,
  SURVEY_STATUS_LABELS,
} from '@/lib/format'
import type { SurveyWithContext } from '@/lib/technical/dashboard'

/**
 * Dated surveys that are still open, soonest first — the "where am I going" panel.
 *
 * Overdue rows stay in this list rather than moving to one of their own. A visit
 * whose slot passed yesterday is still the next thing to deal with, and splitting it
 * out would leave the schedule reading as though the day were clear.
 *
 * Undated surveys are absent by construction: getSurveySummary() only puts dated
 * open rows in `upcoming`, because a date is what makes a row sortable into a
 * schedule at all. The ones Sales requested appear in the handoff queue above, which
 * is a more useful thing to say about them than listing them under "sometime".
 */
export function SurveySchedule({
  surveys,
  scope,
}: {
  surveys: SurveyWithContext[]
  /** Copy only. Which rows arrived was RLS's decision, not this component's. */
  scope: 'mine' | 'team'
}) {
  return (
    <Card>
      <CardHeader
        title={scope === 'team' ? 'Department schedule' : 'My schedule'}
        subtitle="Dated and still open, soonest first"
        action={
          <Link
            href="/technical/surveys"
            className="text-xs font-medium text-brand-slate hover:text-brand-slate"
          >
            All surveys →
          </Link>
        }
      />

      {surveys.length === 0 ? (
        <EmptyState
          title="Nothing scheduled"
          description={
            scope === 'team'
              ? 'No dated survey is outstanding across the department.'
              : 'No dated survey is outstanding for you. Anything Sales requested without a date shows above.'
          }
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {surveys.map((survey) => {
            const late = isSurveyOverdue(survey)

            return (
              <li key={survey.id} className="flex items-start justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/technical/surveys/${survey.id}`}
                      className="truncate text-sm font-medium text-brand-slate hover:text-brand-slate"
                    >
                      {survey.lead?.name ?? 'Unnamed site'}
                    </Link>
                    {survey.is_drone_survey && (
                      <Plane className="h-3.5 w-3.5 text-text-muted/60" aria-label="Drone survey" />
                    )}
                    {late && (
                      <Badge className="bg-status-danger/10 text-status-danger ring-status-danger/25">
                        <AlertTriangle className="mr-1 h-3 w-3" />
                        Slot passed
                      </Badge>
                    )}
                  </div>

                  <p className="mt-1 text-xs text-text-muted">
                    {formatDateTime(survey.scheduled_date)}
                    {scope === 'team' && survey.engineer
                      ? ` · ${survey.engineer.full_name}`
                      : ''}
                  </p>
                </div>

                <Badge className={SURVEY_STATUS_STYLES[survey.status]}>
                  {SURVEY_STATUS_LABELS[survey.status]}
                </Badge>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
