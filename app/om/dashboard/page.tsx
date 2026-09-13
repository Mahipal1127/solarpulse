import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { PulseAIPanel } from '@/components/shared/PulseAIPanel'
import {
  getInstallationSummary,
  getServiceSummary,
  getAmcSummary,
  getUpcomingVisits,
  getFlaggedReadings,
  getOMEmployees,
  getOMDepartmentId,
  getUnownedOMTasks,
  type InstallationSummary,
  type ServiceSummary,
  type AmcSummary,
  type UpcomingVisit,
} from '@/lib/om/dashboard'
import { OM_DEPARTMENT_SLUG, isOMLead } from '@/lib/services/operations'
import {
  formatDate,
  isOverdue,
  amcVisitDisplayStatus,
  AMC_VISIT_STATUS_STYLES,
  AMC_VISIT_STATUS_LABELS,
  INSTALLATION_STATUS_STYLES,
  INSTALLATION_STATUS_LABELS,
  SERVICE_PRIORITY_STYLES,
  SERVICE_PRIORITY_LABELS,
  SERVICE_TICKET_OPEN_STATUSES,
  SERVICE_PRIORITY_RANK,
  INSTALLATION_OPEN_STATUSES,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/**
 * An O&M person's day, and the lead's view of the department behind a toggle —
 * the same one-page/two-audience shape the Technical and Sales dashboards use, on
 * ?tab=team.
 *
 * Every "mine" narrowing below is a display choice, never a permission. A technician
 * and a lead run the identical aggregations; RLS already returned only what each may
 * see, so filtering to my_user_id is what answers "what is on my plate", not what
 * keeps a colleague's site hidden. The CEO passes the guard as everywhere and lands
 * here read-only.
 */
export default async function OMDashboardPage(props: PageProps<'/om/dashboard'>) {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const lead = isOMLead(user)
  const seesTeam = lead || user.roleName === 'CEO'
  const tab = asString(searchParams.tab) === 'team' && seesTeam ? 'team' : 'mine'

  const supabase = await createSupabaseServerClient()

  const [installs, service, amc, visits, taskResult] = await Promise.all([
    getInstallationSummary(user.organization_id),
    getServiceSummary(user.organization_id),
    getAmcSummary(user.organization_id),
    getUpcomingVisits(14),
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
              ? 'Every installation, ticket and contract in Operations & Maintenance.'
              : 'Your installations, tickets and the visits coming up.'}
          </p>
        </div>

        {seesTeam && (
          <div className={SEGMENT_TRACK}>
            <TabLink href="/om/dashboard" active={tab === 'mine'} label="My work" />
            <TabLink href="/om/dashboard?tab=team" active={tab === 'team'} label="Department" />
          </div>
        )}
      </header>

      <PulseAIPanel user={user} />

      {tab === 'team' ? (
        <TeamView
          organizationId={user.organization_id}
          installs={installs}
          service={service}
          amc={amc}
          visits={visits}
          canDelegate={lead}
        />
      ) : (
        <MyWork
          userId={user.id}
          installs={installs}
          service={service}
          visits={visits}
          tasks={myTasks}
        />
      )}
    </div>
  )
}

/** The personal view — §3.1. Also a lead's "My work" tab. */
function MyWork({
  userId,
  installs,
  service,
  visits,
  tasks,
}: {
  userId: string
  installs: InstallationSummary
  service: ServiceSummary
  visits: UpcomingVisit[]
  tasks: AssignedTask[]
}) {
  const myInstalls = installs.all.filter(
    (i) => i.team_lead_id === userId && INSTALLATION_OPEN_STATUSES.includes(i.status)
  )
  const myOpenTickets = service.all
    .filter((t) => t.assigned_to === userId && SERVICE_TICKET_OPEN_STATUSES.includes(t.status))
    .sort((a, b) => {
      const rank = SERVICE_PRIORITY_RANK[b.priority] - SERVICE_PRIORITY_RANK[a.priority]
      if (rank !== 0) return rank
      return a.created_at.localeCompare(b.created_at)
    })

  const openTasks = tasks.filter((t) => t.status !== 'completed').length
  const overdueTasks = tasks.filter(isOverdue).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="My Active Installations"
          value={myInstalls.length}
          hint="Where I am team lead"
        />
        <StatCard
          label="My Open Tickets"
          value={myOpenTickets.length}
          tone={myOpenTickets.some((t) => t.priority === 'urgent' || t.priority === 'high') ? 'danger' : 'default'}
          hint="Assigned to me"
        />
        <StatCard label="Upcoming Visits" value={visits.length} hint="Next 14 days, dept-wide" />
        <StatCard
          label="My Tasks"
          value={openTasks}
          tone={overdueTasks > 0 ? 'warning' : 'default'}
          hint={overdueTasks > 0 ? `${overdueTasks} past due` : 'Assigned by the CEO'}
        />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="My active installations"
            subtitle="Sites where I am the team lead"
            action={
              <Link href="/om/installations" className="text-xs font-medium text-brand-slate hover:text-brand-gold">
                All →
              </Link>
            }
          />
          <InstallationMiniList items={myInstalls} emptyText="No active installations assigned to you." />
        </Card>

        <Card>
          <CardHeader
            title="My open tickets"
            subtitle="Highest priority first"
            action={
              <Link href="/om/service" className="text-xs font-medium text-brand-slate hover:text-brand-gold">
                Queue →
              </Link>
            }
          />
          <TicketMiniList items={myOpenTickets} emptyText="No open service tickets assigned to you." />
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Upcoming maintenance visits"
          subtitle="Scheduled in the next 14 days across the department"
          action={
            <Link href="/om/amc" className="text-xs font-medium text-brand-slate hover:text-brand-gold">
              AMC →
            </Link>
          }
        />
        <VisitMiniList items={visits} />
      </Card>

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

/** The lead's and CEO's view — the department, and work waiting to be handed out. */
async function TeamView({
  organizationId,
  installs,
  service,
  amc,
  visits,
  canDelegate,
}: {
  organizationId: string
  installs: InstallationSummary
  service: ServiceSummary
  amc: AmcSummary
  visits: UpcomingVisit[]
  canDelegate: boolean
}) {
  const departmentId = await getOMDepartmentId(organizationId)

  const [employees, unownedTasks, flagged] = await Promise.all([
    getOMEmployees(organizationId),
    getUnownedOMTasks(organizationId, departmentId),
    getFlaggedReadings(10),
  ])

  const inboxTasks = unownedTasks as unknown as AssignedTask[]

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Open Installations"
          value={installs.open}
          hint={`${installs.completed} completed`}
        />
        <StatCard
          label="Open Tickets"
          value={service.open}
          tone={service.urgent > 0 ? 'danger' : 'default'}
          hint={service.urgent > 0 ? `${service.urgent} urgent/high` : `${service.unassigned} unassigned`}
        />
        <StatCard
          label="AMC Expiring Soon"
          value={amc.expiringSoon}
          tone={amc.expiringSoon > 0 ? 'warning' : 'default'}
          hint={amc.expired > 0 ? `${amc.expired} already expired` : 'Within 30 days'}
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
            subtitle="Assigned to Operations & Maintenance without a named owner. Delegating moves it to that person's dashboard."
          />
          <DepartmentTaskInbox
            tasks={inboxTasks}
            employees={employees}
            departmentName="Operations & Maintenance"
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Upcoming visits" subtitle="Next 14 days" />
          <VisitMiniList items={visits} />
        </Card>

        <Card>
          <CardHeader
            title="Flagged performance"
            subtitle="Readings a surveyor marked as looking wrong"
          />
          {flagged.length === 0 ? (
            <EmptyState title="Nothing flagged" description="No performance readings are currently flagged for follow-up." />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {flagged.map((f) => (
                <li key={f.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={`/om/installations/${f.installation_id}`}
                      className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                    >
                      {f.installation?.customer?.name ?? f.installation?.address ?? 'Installation'}
                    </Link>
                    <span className="shrink-0 text-xs text-text-muted">{formatDate(f.log_date)}</span>
                  </div>
                  {f.notes && <p className="mt-0.5 truncate text-xs text-text-muted">{f.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  )
}

function InstallationMiniList({
  items,
  emptyText,
}: {
  items: InstallationSummary['all']
  emptyText: string
}) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-text-muted">{emptyText}</p>
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 6).map((i) => (
        <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <Link
            href={`/om/installations/${i.id}`}
            className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
          >
            {i.customer?.name ?? 'Unknown customer'}
          </Link>
          <Badge className={INSTALLATION_STATUS_STYLES[i.status]}>
            {INSTALLATION_STATUS_LABELS[i.status]}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function TicketMiniList({
  items,
  emptyText,
}: {
  items: ServiceSummary['all']
  emptyText: string
}) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-text-muted">{emptyText}</p>
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 6).map((t) => (
        <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <Link
            href={`/om/service/${t.id}`}
            className="min-w-0 flex-1 truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
          >
            {t.customer?.name ?? 'Unknown customer'}
          </Link>
          <Badge className={SERVICE_PRIORITY_STYLES[t.priority]}>
            {SERVICE_PRIORITY_LABELS[t.priority]}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

function VisitMiniList({ items }: { items: UpcomingVisit[] }) {
  if (items.length === 0) {
    return (
      <p className="px-5 py-8 text-center text-sm text-text-muted">
        No maintenance visits scheduled in the next 14 days.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 8).map((v) => {
        const display = amcVisitDisplayStatus(v)
        return (
          <li key={v.id} className="flex items-center justify-between gap-3 px-5 py-3">
            <div className="min-w-0">
              <Link
                href={v.contract ? `/om/amc/${v.contract.id}` : '/om/amc'}
                className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
              >
                {v.contract?.customer?.name ?? 'AMC visit'}
              </Link>
              <p className="text-xs text-text-muted">{formatDate(v.scheduled_date)}</p>
            </div>
            <Badge className={AMC_VISIT_STATUS_STYLES[display]}>
              {AMC_VISIT_STATUS_LABELS[display]}
            </Badge>
          </li>
        )
      })}
    </ul>
  )
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={segmentClass(active)}>
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
