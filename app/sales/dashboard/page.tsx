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
import { getSalesEmployees, getSalesDepartmentId } from '@/lib/sales/queries'
import {
  getVisibleLeads,
  getDueFollowUps,
  getTargetProgress,
  getRecentActivity,
} from '@/lib/sales/dashboard'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
import { LEAD_OPEN_STAGES, isFollowUpOverdue, isOverdue, formatCurrency } from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

export default async function SalesDashboardPage(props: PageProps<'/sales/dashboard'>) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const manager = isSalesManager(user)
  const seesTeam = manager || user.roleName === 'CEO'
  const tab = asString(searchParams.tab) === 'team' && seesTeam ? 'team' : 'mine'

  const supabase = await createSupabaseServerClient()

  const [allVisibleLeads, dueFollowUps, targetProgress, activity, taskResult] = await Promise.all([
    getVisibleLeads(user.organization_id),
    getDueFollowUps(),
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
    ? allVisibleLeads.filter((l) => l.assigned_to === user.id)
    : allVisibleLeads

  const myFollowUps = seesTeam
    ? dueFollowUps.filter((f) => f.lead?.assigned_to === user.id)
    : dueFollowUps

  const myOpenLeads = myLeads.filter((l) => LEAD_OPEN_STAGES.includes(l.status))
  const myOverdueFollowUps = myFollowUps.filter(isFollowUpOverdue).length
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
            <TabLink href="/sales/dashboard" active={tab === 'mine'} label="My work" />
            <TabLink href="/sales/dashboard?tab=team" active={tab === 'team'} label="Team" />
          </div>
        )}
      </header>

      {tab === 'team' ? (
        <TeamView
          organizationId={user.organization_id}
          leads={allVisibleLeads}
          followUps={dueFollowUps}
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
            <StatCard
              label="Follow-ups Due"
              value={myFollowUps.length}
              tone={myOverdueFollowUps > 0 ? 'danger' : 'default'}
              hint={
                myOverdueFollowUps > 0 ? `${myOverdueFollowUps} already overdue` : 'Today or earlier'
              }
            />
            <StatCard
              label="My Tasks"
              value={myOpenTasks}
              tone={myOverdueTasks > 0 ? 'warning' : 'default'}
              hint={myOverdueTasks > 0 ? `${myOverdueTasks} past due` : 'Assigned by the CEO'}
            />
            <StatCard
              label="Won This Period"
              value={
                targetProgress ? formatCurrency(targetProgress.achievedAmount) : `${wonCount(myLeads)}`
              }
              tone="success"
              hint={targetProgress ? `${targetProgress.achievedDeals} deals closed` : 'Leads won'}
            />
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
            <TargetProgressCard progress={targetProgress} />

            <Card className="lg:col-span-2">
              <CardHeader
                title="Today's follow-ups"
                subtitle="Due today or already past due. Overdue is computed from the schedule, not a stored flag."
                action={
                  <Link
                    href="/sales/leads"
                    className="text-xs font-medium text-brand-slate hover:text-brand-slate"
                  >
                    All leads →
                  </Link>
                }
              />
              <FollowUpQueue followUps={myFollowUps} readOnly={readOnly} />
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
  leads,
  followUps,
  canDelegate,
}: {
  organizationId: string
  leads: Awaited<ReturnType<typeof getVisibleLeads>>
  followUps: Awaited<ReturnType<typeof getDueFollowUps>>
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

  // One target lookup per employee. The Sales roster is small and these run in
  // parallel; if a department ever outgrows that, this becomes one grouped query.
  const teamTargets = await Promise.all(
    employees.map(async (employee) => ({
      employee,
      progress: await getTargetProgress(employee.id),
    }))
  )

  const openLeads = leads.filter((l) => LEAD_OPEN_STAGES.includes(l.status))
  const overdueFollowUps = followUps.filter(isFollowUpOverdue).length
  const unassignedLeads = leads.filter((l) => l.assigned_to === null).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Team Open Leads" value={openLeads.length} hint={`${leads.length} total`} />
        <StatCard
          label="Follow-ups Due"
          value={followUps.length}
          tone={overdueFollowUps > 0 ? 'danger' : 'default'}
          hint={overdueFollowUps > 0 ? `${overdueFollowUps} overdue` : 'Across the department'}
        />
        <StatCard
          label="Awaiting Delegation"
          value={inboxTasks.length}
          tone={inboxTasks.length > 0 ? 'warning' : 'default'}
          hint="CEO tasks with no owner"
        />
        <StatCard
          label="Unassigned Leads"
          value={unassignedLeads}
          tone={unassignedLeads > 0 ? 'warning' : 'default'}
        />
      </div>

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
