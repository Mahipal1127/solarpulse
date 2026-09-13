import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, StatCard } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { LeadPipeline } from '@/components/sales/LeadPipeline/LeadPipeline'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { FollowUpQueue } from '@/components/sales/Dashboard/FollowUpQueue'
import { TargetProgressCard } from '@/components/sales/Dashboard/TargetProgressCard'
import { ActivityFeed } from '@/components/sales/Dashboard/ActivityFeed'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { PulseAIPanel } from '@/components/shared/PulseAIPanel'
import { getSalesEmployees, getSalesDepartmentId } from '@/lib/sales/queries'
import {
  getSalesSummary,
  getDueFollowUps,
  getDueFollowUpCounts,
  getTargetProgress,
  getTeamTargetProgress,
  getRecentActivity,
  type SalesSummary,
} from '@/lib/sales/dashboard'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
// isFollowUpOverdue is no longer needed here: the overdue figure is counted in SQL
// now rather than derived from the capped list. FollowUpQueue still applies it per
// row for the red border, which is where a per-row judgement belongs.
import { LEAD_OPEN_STAGES, isOverdue, formatCurrency } from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

export default async function SalesDashboardPage(props: PageProps<'/sales/dashboard'>) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const manager = isSalesManager(user)
  const isCeo = user.roleName === 'CEO'
  const seesTeam = manager || isCeo

  /*
   * The CEO defaults to the Team tab, everyone else to their own work.
   *
   * "My work" is a dead screen for the CEO by construction: leads are assigned to
   * Sales members, targets belong to Sales members, and the CEO is neither — so they
   * landed on four zeroes, an empty pipeline and "No target set for this period",
   * with the actual department one unmarked click away. A manager is a genuine
   * salesperson with their own pipeline, so their personal view stays the default.
   *
   * Explicit ?tab= still wins in both directions, so the CEO can reach My work if
   * they want to see it.
   */
  const requestedTab = asString(searchParams.tab)
  const tab =
    requestedTab === 'team' || requestedTab === 'mine'
      ? requestedTab === 'team' && seesTeam
        ? 'team'
        : 'mine'
      : isCeo
        ? 'team'
        : 'mine'

  const supabase = await createSupabaseServerClient()

  /*
   * The follow-up queue is fetched already narrowed to the right person rather than
   * filtered afterwards.
   *
   * This used to fetch the soonest 25 due follow-ups and then keep the ones belonging
   * to the viewer. For an executive that was fine — RLS had returned nothing else. For
   * a manager or the CEO, RLS returns the whole department, so 25 colleagues' calls
   * could fill the cap and leave a manager's own queue rendering "Nothing due today"
   * while their afternoon was in fact full. Narrowing in SQL means the cap applies to
   * the rows that will actually be shown.
   */
  const followUpOwnerId = tab === 'mine' ? user.id : undefined

  const [summary, dueFollowUps, followUpCounts, targetProgress, activity, taskResult] =
    await Promise.all([
      getSalesSummary(user.organization_id),
      getDueFollowUps({ ownerId: followUpOwnerId }),
      getDueFollowUpCounts(followUpOwnerId),
      getTargetProgress(user.id),
      getRecentActivity(),
      supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('assigned_user_id', user.id)
        .neq('status', 'archived')
        .order('due_date', { ascending: true, nullsFirst: false }),
    ])

  const myTasks = (taskResult.data ?? []) as unknown as AssignedTask[]

  // RLS hands a manager the whole department; narrowing to their own rows here is
  // a display choice, not a permission one. For an executive the two sets are
  // already identical — sales_exec_own_leads returned nothing else — so this
  // filter is never what keeps a colleague's pipeline hidden.
  const myLeads = seesTeam
    ? summary.all.filter((l) => l.assigned_to === user.id)
    : summary.all

  const myOpenLeads = myLeads.filter((l) => LEAD_OPEN_STAGES.includes(l.status))
  const myOverdueTasks = myTasks.filter(isOverdue).length
  const myOpenTasks = myTasks.filter((t) => t.status !== 'completed').length

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {tab === 'team' ? 'Team overview' : `Welcome back, ${firstName(user.full_name)}`}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {tab === 'team'
              ? "The whole department's pipeline, plus tasks waiting to be delegated."
              : 'Your leads, your follow-ups, and the tasks assigned to you.'}
          </p>
        </div>

        {seesTeam && (
          <div className={SEGMENT_TRACK}>
            {/*
              Both hrefs name their tab explicitly. A bare /sales/dashboard would fall
              through to the default, which is 'team' for the CEO — so the My work tab
              would bounce them straight back and read as broken.
            */}
            <TabLink href="/sales/dashboard?tab=mine" active={tab === 'mine'} label="My work" />
            <TabLink href="/sales/dashboard?tab=team" active={tab === 'team'} label="Team" />
          </div>
        )}
      </header>

      <PulseAIPanel user={user} />

      {tab === 'team' ? (
        <TeamView
          organizationId={user.organization_id}
          summary={summary}
          followUps={dueFollowUps}
          followUpCounts={followUpCounts}
          canDelegate={manager}
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard
              label="My Open Leads"
              value={myOpenLeads.length}
              hint={`${myLeads.length} total assigned`}
            />
            {/*
              Counted in SQL, not taken from the list's length: the list stops at 25
              rows, so deriving the figure from it would read "25 due" forever once a
              queue got long.
            */}
            <StatCard
              label="Follow-ups Due"
              value={followUpCounts.due}
              tone={followUpCounts.overdue > 0 ? 'danger' : 'default'}
              hint={
                followUpCounts.overdue > 0
                  ? `${followUpCounts.overdue} already overdue`
                  : 'Today or earlier'
              }
            />
            <StatCard
              label="My Tasks"
              value={myOpenTasks}
              tone={myOverdueTasks > 0 ? 'warning' : 'default'}
              hint={myOverdueTasks > 0 ? `${myOverdueTasks} past due` : 'Assigned by the CEO'}
            />
            {/*
              Two different measurements, so two different labels. With a target set
              this is money closed inside that period. Without one there is no period
              to speak of, and the fallback counts won leads for all time — which the
              old version showed under the heading "Won This Period", making a
              lifetime tally look like this month's performance.
            */}
            {targetProgress ? (
              <StatCard
                label="Won This Period"
                value={formatCurrency(targetProgress.achievedAmount)}
                tone="success"
                hint={`${targetProgress.achievedDeals} deals closed`}
              />
            ) : (
              <StatCard
                label="Leads Won"
                value={wonCount(myLeads)}
                tone="success"
                hint="All time · no target set"
              />
            )}
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <TargetProgressCard progress={targetProgress} />

            <Card className="lg:col-span-2">
              <CardHeader
                title="Today's follow-ups"
                /*
                  Says so when the list is shorter than the count above it. The queue
                  stops at 25 rows, and a card reading "40 due" over a list of 25 with
                  nothing to explain the gap looks like a bug in one of the two.
                */
                subtitle={
                  followUpCounts.due > dueFollowUps.length
                    ? `The ${dueFollowUps.length} soonest of ${followUpCounts.due} due. Overdue is computed from the schedule, not a stored flag.`
                    : 'Due today or already past due. Overdue is computed from the schedule, not a stored flag.'
                }
                action={
                  <Link
                    href="/sales/leads"
                    className="text-xs font-medium text-brand-slate hover:text-brand-slate"
                  >
                    All leads →
                  </Link>
                }
              />
              <FollowUpQueue followUps={dueFollowUps} readOnly={readOnly} />
            </Card>
          </div>

          <Card>
            <CardHeader
              title="My pipeline"
              subtitle={`${myOpenLeads.length} open across the stages below`}
              action={
                <Link
                  href="/sales/leads/new"
                  className="text-xs font-medium text-brand-slate hover:text-brand-slate"
                >
                  + Add lead
                </Link>
              }
            />
            <LeadPipeline
              leads={myOpenLeads}
              stages={LEAD_OPEN_STAGES}
              compact
              emptyTitle="Nothing in your pipeline yet"
              emptyDescription="Leads assigned to you appear here as soon as they exist."
            />
          </Card>

          <section className="space-y-3">
            <div>
              <h2 className="text-sm font-semibold text-brand-slate">My assigned tasks</h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Assigned by the CEO. Progress updates save live and are visible to them
                immediately.
              </p>
            </div>
            <MyTaskBoard initialTasks={myTasks} userId={user.id} />
          </section>

          <Card>
            <CardHeader title="Recent activity" subtitle="Movement on the leads you can see" />
            <ActivityFeed entries={activity} />
          </Card>
        </>
      )}
    </div>
  )
}

/**
 * Manager and CEO view. Deliberately a different render, not the same one with
 * more rows: a manager's question is "where is the department" and "who should
 * take this", which are not the questions the personal dashboard answers.
 */
async function TeamView({
  organizationId,
  summary,
  followUps,
  followUpCounts,
  canDelegate,
}: {
  organizationId: string
  summary: SalesSummary
  followUps: Awaited<ReturnType<typeof getDueFollowUps>>
  followUpCounts: Awaited<ReturnType<typeof getDueFollowUpCounts>>
  canDelegate: boolean
}) {
  const supabase = await createSupabaseServerClient()

  const [employees, departmentId] = await Promise.all([
    getSalesEmployees(organizationId),
    getSalesDepartmentId(organizationId),
  ])

  // Department-general tasks: assigned to Sales with nobody named. Anything with
  // an assigned_user_id already belongs to that person's dashboard, and RLS keeps
  // it out of a colleague's reach — only the null-assignee rows are the
  // manager's to hand out.
  const { data: inboxData } = departmentId
    ? await supabase
        .from('tasks')
        .select(TASK_SELECT)
        .eq('assigned_department_id', departmentId)
        .is('assigned_user_id', null)
        .neq('status', 'archived')
        .order('due_date', { ascending: true, nullsFirst: false })
    : { data: [] }

  const inboxTasks = (inboxData ?? []) as unknown as AssignedTask[]

  /*
   * Two queries for the whole roster, not two per person. This was a Promise.all of
   * getTargetProgress() per employee — 2 round trips each, so a ten-person department
   * opened twenty connections to render one row of cards. The old comment here said
   * this should become one grouped query if the roster outgrew it; it now is one.
   *
   * Mapped back over `employees` so the cards stay in roster order rather than in
   * whatever order Postgres returned the targets.
   */
  const targetsByUser = await getTeamTargetProgress(employees.map((e) => e.id))
  const teamTargets = employees.map((employee) => ({
    employee,
    progress: targetsByUser.get(employee.id) ?? null,
  }))

  const openLeads = summary.all.filter((l) => LEAD_OPEN_STAGES.includes(l.status))

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Team Open Leads"
          value={summary.open}
          hint={`${summary.total} total · ${summary.inNegotiation} in negotiation`}
        />
        <StatCard
          label="Follow-ups Due"
          value={followUpCounts.due}
          tone={followUpCounts.overdue > 0 ? 'danger' : 'default'}
          hint={
            followUpCounts.overdue > 0
              ? `${followUpCounts.overdue} overdue`
              : 'Across the department'
          }
        />
        <StatCard
          label="Awaiting Delegation"
          value={inboxTasks.length}
          tone={inboxTasks.length > 0 ? 'warning' : 'default'}
          hint="CEO tasks with no owner"
        />
        <StatCard
          label="Unassigned Leads"
          value={summary.unassigned}
          tone={summary.unassigned > 0 ? 'warning' : 'default'}
          hint="Nobody is chasing these"
        />
      </div>

      {summary.capped && (
        <p className="text-xs text-text-muted">
          Showing the most recent leads only — the figures above cover what could be read in
          one page, not the full history.
        </p>
      )}

      {canDelegate && (
        <Card>
          <CardHeader
            title="Tasks awaiting delegation"
            subtitle="Assigned to Sales without a named owner. Delegating moves it to that person's dashboard."
          />
          <DepartmentTaskInbox
            tasks={inboxTasks}
            employees={employees}
            departmentName="Sales"
          />
        </Card>
      )}

      <Card>
        <CardHeader
          title="Department pipeline"
          subtitle="Every open lead in Sales, with its owner"
          action={
            <Link
              href="/sales/leads"
              className="text-xs font-medium text-brand-slate hover:text-brand-slate"
            >
              Open full board →
            </Link>
          }
        />
        <LeadPipeline
          leads={openLeads}
          stages={LEAD_OPEN_STAGES}
          showAssignee
          emptyTitle="No open leads in the department"
          emptyDescription="Once the team logs leads they appear here, grouped by stage."
        />
      </Card>

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">Target progress</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Credit follows whoever closed the deal, so a reassigned lead does not move it.
          </p>
        </div>
        {teamTargets.length === 0 ? (
          <Card>
            <div className="px-5 py-8 text-center text-sm text-text-muted">
              No active users in the Sales department yet.
            </div>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            {teamTargets.map(({ employee, progress }) => (
              <TargetProgressCard
                key={employee.id}
                progress={progress}
                ownerLabel={employee.full_name}
              />
            ))}
          </div>
        )}
      </section>

      <Card>
        <CardHeader
          title="Follow-ups due across the team"
          subtitle="Today or earlier, soonest first"
        />
        <FollowUpQueue followUps={followUps} readOnly={!canDelegate} />
      </Card>
    </>
  )
}

function TabLink({
  href,
  active,
  label,
}: {
  href: string
  active: boolean
  label: string
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={segmentClass(active)}
    >
      {label}
    </Link>
  )
}

function wonCount(leads: { status: string }[]): number {
  return leads.filter((l) => l.status === 'won').length
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
