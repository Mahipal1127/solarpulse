import 'server-only'

import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, EmptyState, ProgressBar } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { formatDate, formatDateTime, STATUS_LABELS, STATUS_STYLES } from '@/lib/format'
import type { TaskStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * What the organisation reports upward: department rollups, and what individual
 * people have actually submitted.
 *
 * This replaced "AI Assistant" in the nav. The assistant moved onto the dashboard,
 * where the numbers it discusses are visible; this slot went to the thing a CEO
 * opens a nav entry for — reading what came in.
 *
 * BOTH TABS SHOW SUBMITTED DATA, NOT DERIVED DATA
 * The department tab reads `department_reports`, which each department writes for
 * itself (policy `department_manage_own_reports`; the CEO gets read-only access via
 * `ceo_view_department_reports`).
 *
 * The people tab reads `task_updates` — the append-only progress log, where each row
 * is stamped `updated_by`. Those rows are authored by the person doing the work,
 * which is exactly why the CEO's task panel cannot write them. So this tab is a
 * genuine record of what people reported, not a management guess restated as fact.
 *
 * There is no separate per-employee report table yet. When one is wanted, it needs a
 * migration and its own RLS policy; deriving a fake one here would have looked like
 * a feature while being a rollup nobody submitted.
 */

type Tab = 'departments' | 'people'

type ReportRow = {
  id: string
  department_id: string
  report_date: string
  summary: string | null
  tasks_completed: number
  tasks_pending: number
  tasks_delayed: number
  departments: { name: string } | null
}

type UpdateRow = {
  id: string
  note: string | null
  progress_percent: number | null
  status: TaskStatus | null
  created_at: string
  users: { full_name: string; departments: { name: string } | null } | null
  tasks: { id: string; title: string } | null
}

export default async function ReportsPage(props: PageProps<'/reports'>) {
  await requireRole('CEO')
  const searchParams = await props.searchParams
  const tab: Tab = asString(searchParams.tab) === 'people' ? 'people' : 'departments'

  const supabase = await createSupabaseServerClient()

  /*
   * Both sides are fetched regardless of the active tab. Each is a single indexed
   * read, and paying for both keeps tab switching instant instead of round-tripping
   * for data the other tab already had.
   */
  const [{ data: reportData }, { data: updateData }] = await Promise.all([
    supabase
      .from('department_reports')
      .select(
        'id, department_id, report_date, summary, tasks_completed, tasks_pending, tasks_delayed, departments(name)'
      )
      .order('report_date', { ascending: false })
      .limit(120),
    supabase
      .from('task_updates')
      .select(
        'id, note, progress_percent, status, created_at, users(full_name, departments(name)), tasks(id, title)'
      )
      .order('created_at', { ascending: false })
      .limit(150),
  ])

  const reports = (reportData ?? []) as unknown as ReportRow[]
  const updates = (updateData ?? []) as unknown as UpdateRow[]

  // Group the person-level updates by author, preserving the newest-first order the
  // query already established.
  const byPerson = new Map<
    string,
    { name: string; department: string | null; updates: UpdateRow[] }
  >()
  for (const update of updates) {
    const name = update.users?.full_name
    if (!name) continue // A deleted user's rows stay for audit; they have no person to file under.
    if (!byPerson.has(name)) {
      byPerson.set(name, {
        name,
        department: update.users?.departments?.name ?? null,
        updates: [],
      })
    }
    byPerson.get(name)!.updates.push(update)
  }
  const people = [...byPerson.values()]

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-slate">Reports</h1>
        <p className="mt-1 text-sm text-text-muted">
          What departments and people have submitted. Read-only — these are their words, not
          edits made here.
        </p>
      </header>

      <div className={`${SEGMENT_TRACK} mb-6 w-fit`}>
        <Link
          href="/reports"
          aria-current={tab === 'departments' ? 'page' : undefined}
          className={segmentClass(tab === 'departments')}
        >
          By department
        </Link>
        <Link
          href="/reports?tab=people"
          aria-current={tab === 'people' ? 'page' : undefined}
          className={segmentClass(tab === 'people')}
        >
          By person
        </Link>
      </div>

      {tab === 'departments' ? (
        reports.length === 0 ? (
          <Card>
            <EmptyState
              title="No department reports yet"
              description="Departments publish a daily rollup from their own module. Reports appear here as they are submitted."
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {reports.map((report) => {
              const total =
                report.tasks_completed + report.tasks_pending + report.tasks_delayed
              const percentDone =
                total > 0 ? Math.round((report.tasks_completed / total) * 100) : 0

              return (
                <Card key={report.id}>
                  <CardHeader
                    title={report.departments?.name ?? 'Unknown department'}
                    subtitle={formatDate(report.report_date)}
                  />
                  <div className="space-y-4 px-5 py-4">
                    {report.summary ? (
                      <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                        {report.summary}
                      </p>
                    ) : (
                      <p className="text-sm text-text-muted/60">
                        No written summary was submitted with this report.
                      </p>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                      <Metric label="Completed" value={report.tasks_completed} tone="text-status-success" />
                      <Metric label="Pending" value={report.tasks_pending} tone="text-text-muted" />
                      <Metric label="Delayed" value={report.tasks_delayed} tone="text-status-danger" />
                    </div>

                    {total > 0 && (
                      <div className="flex items-center gap-3">
                        <div className="flex-1">
                          <ProgressBar value={percentDone} />
                        </div>
                        <span className="shrink-0 text-xs font-medium text-text-muted">
                          {percentDone}% of {total} complete
                        </span>
                      </div>
                    )}
                  </div>
                </Card>
              )
            })}
          </div>
        )
      ) : people.length === 0 ? (
        <Card>
          <EmptyState
            title="No submissions yet"
            description="Progress updates people post on their own tasks appear here, newest first."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {people.map((person) => (
            <Card key={person.name}>
              <CardHeader
                title={person.name}
                subtitle={[person.department, `${person.updates.length} update${person.updates.length === 1 ? '' : 's'}`]
                  .filter(Boolean)
                  .join(' · ')}
              />
              <ol className="divide-y divide-border-subtle">
                {person.updates.slice(0, 8).map((update) => (
                  <li key={update.id} className="px-5 py-3.5">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      {update.tasks ? (
                        <Link
                          href={`/tasks/${update.tasks.id}`}
                          className="text-sm font-medium text-brand-slate hover:text-brand-gold"
                        >
                          {update.tasks.title}
                        </Link>
                      ) : (
                        <span className="text-sm font-medium text-text-muted">
                          Task no longer available
                        </span>
                      )}
                      <span className="shrink-0 text-xs text-text-muted">
                        {formatDateTime(update.created_at)}
                      </span>
                    </div>

                    {update.note && (
                      <p className="mt-1 whitespace-pre-wrap text-sm text-text-muted">
                        {update.note}
                      </p>
                    )}

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {update.status && (
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${STATUS_STYLES[update.status]}`}
                        >
                          {STATUS_LABELS[update.status]}
                        </span>
                      )}
                      {update.progress_percent !== null && (
                        <span className="text-xs text-text-muted">
                          reported {update.progress_percent}% complete
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** Matches the helper the approvals and tasks pages use for the same job. */
function asString(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

function Metric({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-xl bg-surface-bg px-3 py-2.5 text-center">
      <p className={`text-xl font-semibold ${tone}`}>{value}</p>
      <p className="mt-0.5 text-xs text-text-muted">{label}</p>
    </div>
  )
}
