import 'server-only'

import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { listSubmittedReports, listReportAuthors } from '@/lib/services/employee-reports'
import { REPORT_PERIOD_LABELS } from '@/lib/reports/constants'
import { Card, CardHeader, EmptyState, ProgressBar, Badge } from '@/components/ui/primitives'
import { EmployeeReportFilters } from '@/components/ceo/EmployeeReportFilters'
import { ReportAttachmentButton } from '@/components/ceo/ReportAttachmentButton'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { formatDate, formatDateTime, STATUS_LABELS, STATUS_STYLES } from '@/lib/format'
import type { TaskStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * What the organisation reports upward: department rollups, what individual people have
 * logged against their tasks, and the periodic reports employees submit about their own
 * work.
 *
 * This replaced "AI Assistant" in the nav. The assistant moved onto the dashboard,
 * where the numbers it discusses are visible; this slot went to the thing a CEO
 * opens a nav entry for — reading what came in.
 *
 * ALL THREE TABS SHOW SUBMITTED DATA, NOT DERIVED DATA
 * The department tab reads `department_reports`, which each department writes for
 * itself (policy `department_manage_own_reports`; the CEO gets read-only access via
 * `ceo_view_department_reports`).
 *
 * The people tab reads `task_updates` — the append-only progress log, where each row
 * is stamped `updated_by`. Those rows are authored by the person doing the work,
 * which is exactly why the CEO's task panel cannot write them. So this tab is a
 * genuine record of what people reported, not a management guess restated as fact.
 *
 * The employees tab reads `employee_reports` (0019) through listSubmittedReports, which
 * returns SUBMITTED rows only — a draft is the author's private working copy and the RLS
 * policy hides it from the CEO entirely. Nothing on this page can edit any of the three:
 * the CEO has no write policy on employee_reports at all.
 *
 * The three answer different questions and none subsumes another: a department rollup is
 * the team's number, a task update is one moment on one task, and an employee report is a
 * person's own account of their week.
 */

type Tab = 'departments' | 'people' | 'employees'

/** Just enough of a department to fill the filter — the page never needs the rest. */
type DepartmentOption = { id: string; name: string }

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
  const user = await requireRole('CEO')
  const searchParams = await props.searchParams
  const tabParam = asString(searchParams.tab)
  const tab: Tab =
    tabParam === 'people' ? 'people' : tabParam === 'employees' ? 'employees' : 'departments'

  // Empty string and absent mean the same thing here — "no filter" — so both collapse to
  // null before they reach the query, which treats null as "do not add this clause".
  const departmentFilter = asString(searchParams.department) || null
  const employeeFilter = asString(searchParams.employee) || null

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

  /*
   * The employees tab is the one exception to the eager fetch above, and only reads when
   * it is actually open. Its query depends on the department/employee params, so a
   * prefetch made while the CEO was on another tab would fetch the wrong slice and be
   * thrown away the moment a filter changed — there is nothing to keep warm.
   */
  let employeeReports: Awaited<ReturnType<typeof listSubmittedReports>> = []
  let reportAuthors: Awaited<ReturnType<typeof listReportAuthors>> = []
  let departments: DepartmentOption[] = []

  if (tab === 'employees') {
    const [submitted, authors, { data: departmentData }] = await Promise.all([
      listSubmittedReports(user, { departmentId: departmentFilter, userId: employeeFilter }),
      listReportAuthors(user),
      supabase
        .from('departments')
        .select('id, name')
        .eq('organization_id', user.organization_id)
        .order('name'),
    ])

    employeeReports = submitted
    reportAuthors = authors
    departments = (departmentData ?? []) as DepartmentOption[]
  }

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

  /*
   * Employee reports grouped under their author, keyed on user_id rather than on the
   * name — two people can share a name, and merging their reports into one card would
   * misattribute someone's account of their own work. The query's newest-submission-first
   * order is preserved inside each group.
   */
  const byAuthor = new Map<
    string,
    { id: string; name: string; department: string | null; reports: typeof employeeReports }
  >()
  for (const report of employeeReports) {
    const existing = byAuthor.get(report.user_id)
    if (existing) {
      existing.reports.push(report)
      continue
    }
    byAuthor.set(report.user_id, {
      id: report.user_id,
      name: report.users?.full_name ?? 'Former employee',
      department: report.users?.departments?.name ?? null,
      reports: [report],
    })
  }
  const authored = [...byAuthor.values()]

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
        <Link
          href="/reports?tab=employees"
          aria-current={tab === 'employees' ? 'page' : undefined}
          className={segmentClass(tab === 'employees')}
        >
          Employee reports
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
      ) : tab === 'people' ? (
        people.length === 0 ? (
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
        )
      ) : (
        <>
          {/*
            The filters render above the results and outside the empty check on purpose:
            an empty list is usually the answer to a filter, and hiding the controls that
            produced it would leave no way back except the browser's back button.
          */}
          <EmployeeReportFilters departments={departments} authors={reportAuthors} />

          {authored.length === 0 ? (
            <Card>
              <EmptyState
                title={
                  departmentFilter || employeeFilter
                    ? 'No reports match this filter'
                    : 'No employee reports yet'
                }
                description={
                  departmentFilter || employeeFilter
                    ? 'Nobody in this selection has submitted a report yet. Clear the filters to see everything that has come in.'
                    : 'Employees submit daily, weekly or monthly reports of their own work from the My Reports tab in their department. Submitted reports appear here — drafts stay private to their author.'
                }
              />
            </Card>
          ) : (
            <div className="space-y-4">
              {authored.map((person) => (
                <Card key={person.id}>
                  <CardHeader
                    title={person.name}
                    subtitle={[
                      person.department ?? 'No department',
                      `${person.reports.length} report${person.reports.length === 1 ? '' : 's'}`,
                    ].join(' · ')}
                  />
                  <ol className="divide-y divide-border-subtle">
                    {person.reports.map((report) => (
                      <li key={report.id} className="space-y-2.5 px-5 py-4">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-medium text-brand-slate">
                              {REPORT_PERIOD_LABELS[report.period]} ·{' '}
                              {report.period_start === report.period_end
                                ? formatDate(report.period_start)
                                : `${formatDate(report.period_start)} – ${formatDate(report.period_end)}`}
                            </span>
                            {/*
                              Provenance, shown rather than hidden: the CEO is reading this
                              as the person's own account, so a passage that started as a
                              machine draft says so. The employee still edited and submitted
                              it under their own name.
                            */}
                            {report.ai_generated && (
                              <Badge className="bg-brand-gold/10 text-brand-slate ring-brand-gold/30">
                                AI draft
                              </Badge>
                            )}
                          </div>
                          {report.submitted_at && (
                            <span className="shrink-0 text-xs text-text-muted">
                              Submitted {formatDateTime(report.submitted_at)}
                            </span>
                          )}
                        </div>

                        {report.content ? (
                          <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-muted">
                            {report.content}
                          </p>
                        ) : (
                          <p className="text-sm text-text-muted/60">
                            No written summary — this report was filed as an attachment.
                          </p>
                        )}

                        {report.attachment_path && (
                          <ReportAttachmentButton
                            reportId={report.id}
                            fileName={report.attachment_name}
                          />
                        )}
                      </li>
                    ))}
                  </ol>
                </Card>
              ))}
            </div>
          )}
        </>
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
