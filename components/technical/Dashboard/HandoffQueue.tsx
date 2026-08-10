import Link from 'next/link'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { CalendarClock } from 'lucide-react'
import { formatDate, daysSince } from '@/lib/format'
import type { SurveyWithContext } from '@/lib/technical/dashboard'

/**
 * Site visit requests Sales handed over that nobody has put a date on.
 *
 * This panel is the reason the dashboard exists in the shape it does. The client
 * named this exact handoff — Sales asks for a survey, Technical does not pick it up,
 * and the customer hears nothing — as their main source of delay, so it sits above
 * the stat cards rather than below them, and it shows the rows themselves rather
 * than a count. A number tells someone there is a problem; the rows tell them whose.
 *
 * The queue is derived, not stored: isSurveyAwaitingSchedule() reads
 * site_visit_request_id, status and scheduled_date. Nothing sets an "awaiting" flag,
 * so nothing can leave one set after the date is filled in.
 *
 * Rows come from RLS, which means an engineer sees the requests parked on their own
 * name and a lead sees the department's. Neither number is filtered here.
 */
export function HandoffQueue({
  surveys,
  canOperate,
  scope,
}: {
  surveys: SurveyWithContext[]
  /** Technical member: may open the survey and set a date. False for the CEO. */
  canOperate: boolean
  /** 'mine' or 'team' — copy only; which rows arrived was RLS's decision. */
  scope: 'mine' | 'team'
}) {
  if (surveys.length === 0) {
    return (
      <Card>
        <CardHeader
          title="Pending handoffs"
          subtitle="Site visits Sales requested, waiting on a date"
        />
        <EmptyState
          title="Nothing waiting on a date"
          description={
            scope === 'team'
              ? 'Every site visit Sales has requested has a date on it. This is the queue the client flagged as a delay source, so an empty one is the goal.'
              : 'No site visit requests are parked on your name without a date.'
          }
        />
      </Card>
    )
  }

  /** Longest wait first: the customer who has heard nothing for a week outranks today's. */
  const ordered = [...surveys].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )

  return (
    <Card className="border-status-warning/30 ring-1 ring-status-warning/15">
      <CardHeader
        title="Pending handoffs"
        subtitle={`${surveys.length} site visit ${surveys.length === 1 ? 'request has' : 'requests have'} no date yet — Sales is waiting on this`}
        action={
          <Link
            href="/technical/surveys"
            className="text-xs font-medium text-brand-slate hover:text-brand-slate"
          >
            All surveys →
          </Link>
        }
      />

      <ul className="divide-y divide-border-subtle">
        {ordered.map((survey) => {
          const waiting = daysSince(survey.created_at)

          return (
            <li
              key={survey.id}
              className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/technical/surveys/${survey.id}`}
                    className="truncate text-sm font-medium text-brand-slate hover:text-brand-slate"
                  >
                    {survey.lead?.name ?? 'Unnamed site'}
                  </Link>
                  <Badge
                    className={
                      waiting >= 3
                        ? 'bg-status-danger/10 text-status-danger ring-status-danger/25'
                        : 'bg-status-warning/10 text-status-warning ring-status-warning/25'
                    }
                  >
                    {waiting === 0
                      ? 'Requested today'
                      : `Waiting ${waiting} ${waiting === 1 ? 'day' : 'days'}`}
                  </Badge>
                </div>

                <p className="mt-1 text-xs text-text-muted">
                  {survey.engineer?.full_name ?? 'Unassigned'}
                  {' · requested '}
                  {formatDate(survey.created_at)}
                  {survey.lead?.phone ? ` · ${survey.lead.phone}` : ''}
                </p>
              </div>

              {canOperate && (
                <Link
                  href={`/technical/surveys/${survey.id}/edit`}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-brand-gold px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-brand-orange"
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  Set a date
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </Card>
  )
}
