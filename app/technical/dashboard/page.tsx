import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, StatCard } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { HandoffQueue } from '@/components/technical/Dashboard/HandoffQueue'
import { SurveySchedule } from '@/components/technical/Dashboard/SurveySchedule'
import { DesignBoard } from '@/components/technical/Dashboard/DesignBoard'
import {
  getSurveySummary,
  getDesignSummary,
  getTicketSummary,
  getUnownedDepartmentTasks,
  getTechnicalEmployees,
  getTechnicalDepartmentId,
  type SurveySummary,
  type DesignSummary,
} from '@/lib/technical/dashboard'
import { TECHNICAL_DEPARTMENT_SLUG, isTechnicalLead } from '@/lib/services/technical'
import { isOverdue } from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/**
 * A Technical engineer's day, and the lead's view of the department behind a toggle.
 *
 * requireDepartment rather than the layout's requireUser: the layout has to admit a
 * Sales visitor following the IT ticket they raised, but this page is not for them,
 * and the sidebar already trims their nav down to the one page that is. The CEO
 * passes the guard as they do everywhere and lands here read-only.
 *
 * One page for both audiences, switched on ?tab=team — the same shape the Sales
 * Manager dashboard uses, deliberately not a second route. A lead's own surveys and
 * designs are still their work; the team view answers a different question about the
 * same data rather than replacing the personal one.
 *
 * The "mine" filters below narrow a lead's wider row set to their own work. Every one
 * of them is a display choice, never a permission: for an engineer the two sets are
 * already identical because RLS returned nothing else, so none of these filters is
 * what keeps a colleague's survey hidden.
 */
export default async function TechnicalDashboardPage(
  props: PageProps<'/technical/dashboard'>
) {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const lead = isTechnicalLead(user)
  const seesTeam = lead || user.roleName === 'CEO'
  const tab = asString(searchParams.tab) === 'team' && seesTeam ? 'team' : 'mine'

  const supabase = await createSupabaseServerClient()

  const [surveys, designs, taskResult] = await Promise.all([
    getSurveySummary(),
    getDesignSummary(),
    supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('assigned_user_id', user.id)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])

  const myTasks = (taskResult.data ?? []) as unknown as AssignedTask[]

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {tab === 'team' ? 'Department overview' : `Welcome back, ${firstName(user.full_name)}`}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {tab === 'team'
              ? 'Every survey and design in Technical, plus work waiting to be handed out.'
              : 'Your surveys, your designs, and what Sales is waiting on.'}
          </p>
        </div>

        {seesTeam && (
          <div className={SEGMENT_TRACK}>
            <TabLink href="/technical/dashboard" active={tab === 'mine'} label="My work" />
            <TabLink
              href="/technical/dashboard?tab=team"
              active={tab === 'team'}
              label="Department"
            />
          </div>
        )}
      </header>

      {tab === 'team' ? (
        <TeamView
          organizationId={user.organization_id}
          surveys={surveys}
          designs={designs}
          canDelegate={lead}
          canOperate={!readOnly}
        />
      ) : (
        <MyWork
          userId={user.id}
          surveys={surveys}
          designs={designs}
          tasks={myTasks}
          canOperate={!readOnly}
        />
      )}
    </div>
  )
}

/**
 * The engineer's own view — and a lead's, on the "My work" tab. Narrowing happens
 * here rather than in the SQL so the aggregations stay a single description of
 * "what may I see", with ownership layered on top as presentation.
 */
function MyWork({
  userId,
  surveys,
  designs,
  tasks,
  canOperate,
}: {
  userId: string
  surveys: SurveySummary
  designs: DesignSummary
  tasks: AssignedTask[]
  canOperate: boolean
}) {
  const mine = surveys.all.filter((s) => s.assigned_engineer_id === userId)
  const myAwaiting = surveys.awaitingSchedule.filter((s) => s.assigned_engineer_id === userId)
  const myOverdue = surveys.overdue.filter((s) => s.assigned_engineer_id === userId)
  const myUpcoming = surveys.upcoming.filter((s) => s.assigned_engineer_id === userId)
  const myOpen = mine.filter((s) => s.status === 'assigned' || s.status === 'in_progress')

  /**
   * Mirrors the design detail page's mayEdit, minus the lead clause: a design is
   * "mine" if I drew it or if it came off my survey. The second half matters —
   * handing a colleague's design back is not the same as it disappearing from the
   * dashboard of the engineer who surveyed the roof.
   */
  const ownsDesign = (d: DesignWithContextLike) =>
    d.designed_by === userId || d.survey?.assigned_engineer_id === userId

  const myWip = designs.wip.filter(ownsDesign)
  const myReady = designs.readyForSales.filter(ownsDesign)

  const openTasks = tasks.filter((t) => t.status !== 'completed').length
  const overdueTasks = tasks.filter(isOverdue).length

  return (
    <>
      {/*
        The handoff queue sits above the stat cards, not below them. It is the one
        thing on this page that represents a customer waiting on us with nothing
        happening, and the client named it as their main source of delay.
      */}
      <HandoffQueue surveys={myAwaiting} canOperate={canOperate} scope="mine" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="My Open Surveys"
          value={myOpen.length}
          tone={myOverdue.length > 0 ? 'danger' : 'default'}
          hint={
            myOverdue.length > 0
              ? `${myOverdue.length} past their slot`
              : `${mine.length} total assigned`
          }
        />
        <StatCard
          label="Awaiting a Date"
          value={myAwaiting.length}
          tone={myAwaiting.length > 0 ? 'warning' : 'default'}
          hint="Sales requested, not scheduled"
        />
        <StatCard
          label="Designs in Progress"
          value={myWip.length}
          hint={myReady.length > 0 ? `${myReady.length} ready for Sales` : 'Draft or under review'}
        />
        <StatCard
          label="My Tasks"
          value={openTasks}
          tone={overdueTasks > 0 ? 'warning' : 'default'}
          hint={overdueTasks > 0 ? `${overdueTasks} past due` : 'Assigned by the CEO'}
        />
      </div>

      <SurveySchedule surveys={myUpcoming} scope="mine" />

      <DesignBoard wip={myWip} readyForSales={myReady} canOperate={canOperate} scope="mine" />

      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-semibold text-brand-slate">My assigned tasks</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Assigned by the CEO. Progress updates save live and are visible to them immediately.
          </p>
        </div>
        <MyTaskBoard initialTasks={tasks} userId={userId} />
      </section>
    </>
  )
}

/** Structural shape of a design row, enough for the ownership test above. */
type DesignWithContextLike = {
  designed_by: string
  survey: { assigned_engineer_id: string } | null
}

/**
 * The lead's and CEO's view. A different render rather than the same one with more
 * rows: "where is the department" and "who should take this" are not the questions
 * the personal dashboard answers.
 */
async function TeamView({
  organizationId,
  surveys,
  designs,
  canDelegate,
  canOperate,
}: {
  organizationId: string
  surveys: SurveySummary
  designs: DesignSummary
  /** Technical lead: may hand out unowned tasks. False for the CEO, who reads only. */
  canDelegate: boolean
  canOperate: boolean
}) {
  const departmentId = await getTechnicalDepartmentId(organizationId)

  const [employees, unownedTasks, tickets] = await Promise.all([
    getTechnicalEmployees(organizationId, departmentId),
    getUnownedDepartmentTasks(organizationId, departmentId),
    getTicketSummary(),
  ])

  const inboxTasks = unownedTasks as unknown as AssignedTask[]

  const workload = employees.map((employee) => ({
    employee,
    open: surveys.all.filter(
      (s) =>
        s.assigned_engineer_id === employee.id &&
        (s.status === 'assigned' || s.status === 'in_progress')
    ).length,
    overdue: surveys.overdue.filter((s) => s.assigned_engineer_id === employee.id).length,
    designs: designs.wip.filter((d) => d.designed_by === employee.id).length,
  }))

  return (
    <>
      <HandoffQueue surveys={surveys.awaitingSchedule} canOperate={canOperate} scope="team" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard
          label="Open Surveys"
          value={surveys.open}
          tone={surveys.overdue.length > 0 ? 'danger' : 'default'}
          hint={
            surveys.overdue.length > 0
              ? `${surveys.overdue.length} past their slot`
              : `${surveys.completed} completed`
          }
        />
        <StatCard
          label="Awaiting Review"
          value={designs.awaitingReview}
          hint={`${designs.approved} approved, ${designs.sentToSales} with Sales`}
        />
        <StatCard
          label="Awaiting Delegation"
          value={inboxTasks.length}
          tone={inboxTasks.length > 0 ? 'warning' : 'default'}
          hint="CEO tasks with no owner"
        />
      </div>

      {canDelegate && (
        <Card>
          <CardHeader
            title="Tasks awaiting delegation"
            subtitle="Assigned to Technical without a named owner. Delegating moves it to that person's dashboard."
          />
          <DepartmentTaskInbox
            tasks={inboxTasks}
            employees={employees}
            departmentName="Technical"
          />
        </Card>
      )}

      <SurveySchedule surveys={surveys.upcoming} scope="team" />

      <DesignBoard
        wip={designs.wip}
        readyForSales={designs.readyForSales}
        canOperate={canOperate}
        scope="team"
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Who is carrying what"
            subtitle="Open surveys and in-progress designs per engineer"
          />
          {workload.length === 0 ? (
            <div className="px-5 py-8 text-center text-sm text-text-muted">
              No active users in the Technical department yet.
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle">
              {workload.map(({ employee, open, overdue, designs: designCount }) => (
                <li
                  key={employee.id}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <p className="truncate text-sm font-medium text-brand-slate">
                    {employee.full_name}
                  </p>
                  <div className="flex shrink-0 items-center gap-4 text-xs text-text-muted">
                    <span>
                      {open} survey{open === 1 ? '' : 's'}
                      {overdue > 0 && <span className="ml-1 text-status-danger">({overdue} late)</span>}
                    </span>
                    <span>
                      {designCount} design{designCount === 1 ? '' : 's'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="IT support"
            subtitle="Raised from across the company"
            action={
              <Link
                href="/technical/it-support"
                className="text-xs font-medium text-brand-slate hover:text-brand-slate"
              >
                Queue →
              </Link>
            }
          />
          <div className="space-y-3 px-5 py-4">
            <Row label="Open" value={tickets.open} />
            <Row label="Unassigned" value={tickets.unassigned} tone={tickets.unassigned > 0} />
            <Row label="In progress" value={tickets.inProgress} />
          </div>
        </Card>
      </div>
    </>
  )
}

function Row({ label, value, tone }: { label: string; value: number; tone?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className={`text-lg font-semibold ${tone ? 'text-status-warning' : 'text-brand-slate'}`}>
        {value}
      </p>
    </div>
  )
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
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

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
