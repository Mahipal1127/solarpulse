import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { SEGMENT_TRACK, segmentClass } from '@/components/shared/chrome'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { PulseAIPanel } from '@/components/shared/PulseAIPanel'
import { AgingBadge } from '@/components/discom/AgingBadge'
import {
  getNetMeteringSummary,
  getSubsidySummary,
  getPendingHandoffs,
  getDiscomEmployees,
  getDiscomDepartmentId,
  getUnownedDiscomTasks,
  type NetMeteringSummary,
  type SubsidySummary,
  type NetMeteringWithAging,
  type SubsidyWithAging,
  type PendingHandoff,
} from '@/lib/discom/dashboard'
import { DISCOM_DEPARTMENT_SLUG, isDiscomLead } from '@/lib/services/discom'
import {
  formatDate,
  formatCurrency,
  formatDaysInStatus,
  NET_METERING_STATUS_STYLES,
  NET_METERING_STATUS_LABELS,
  SUBSIDY_STATUS_STYLES,
  SUBSIDY_STATUS_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/**
 * A liaison's day, and the lead's view of the whole department behind a ?tab=team
 * toggle — the same one-page/two-audience shape O&M, Technical and Sales use.
 *
 * THE STALENESS BLOCK IS THE POINT. Every view leads with cases that have sat too
 * long in one status, longest-stuck-first, because "where is each case stuck and for
 * how long" is what this module exists to answer. The counts and lists are all
 * derived at read time from status history — see lib/discom/dashboard.ts.
 *
 * Every "mine" narrowing is a display choice, never a permission: a liaison and a
 * lead run the identical aggregations and RLS already returned only what each may
 * see, so filtering to my user id answers "what is on my plate", not what keeps a
 * colleague's case hidden. The CEO passes the guard everywhere and lands here on the
 * team tab, read-only.
 */
export default async function DiscomDashboardPage(props: PageProps<'/discom/dashboard'>) {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const lead = isDiscomLead(user)
  const seesTeam = lead || user.roleName === 'CEO'
  const tab = asString(searchParams.tab) === 'team' && seesTeam ? 'team' : 'mine'

  const supabase = await createSupabaseServerClient()

  const [netMetering, subsidy, taskResult] = await Promise.all([
    getNetMeteringSummary(user.organization_id),
    getSubsidySummary(user.organization_id),
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
              ? 'Every net metering and subsidy case in the DISCOM liaison desk, and where each is stuck.'
              : 'Your cases, ordered by how long each has been waiting on the board.'}
          </p>
        </div>

        {seesTeam && (
          <div className={SEGMENT_TRACK}>
            <TabLink href="/discom/dashboard" active={tab === 'mine'} label="My work" />
            <TabLink href="/discom/dashboard?tab=team" active={tab === 'team'} label="Department" />
          </div>
        )}
      </header>

      <PulseAIPanel user={user} />

      {tab === 'team' ? (
        <TeamView
          organizationId={user.organization_id}
          netMetering={netMetering}
          subsidy={subsidy}
          canDelegate={lead}
        />
      ) : (
        <MyWork
          userId={user.id}
          netMetering={netMetering}
          subsidy={subsidy}
          tasks={myTasks}
        />
      )}
    </div>
  )
}

/** The personal view. Also a lead's "My work" tab. */
function MyWork({
  userId,
  netMetering,
  subsidy,
  tasks,
}: {
  userId: string
  netMetering: NetMeteringSummary
  subsidy: SubsidySummary
  tasks: AssignedTask[]
}) {
  const myNm = netMetering.all.filter((c) => c.assigned_to === userId)
  const mySubsidy = subsidy.all.filter((c) => c.assigned_to === userId)

  // The needs-attention list is the personal version of the module's whole point:
  // my live cases past the staleness threshold, longest-stuck-first (both summaries
  // already arrive sorted that way).
  const myStaleNm = myNm.filter((c) => c.isStale)
  const myStaleSubsidy = mySubsidy.filter((c) => c.isStale)
  const staleCount = myStaleNm.length + myStaleSubsidy.length

  const myOpenNm = myNm.filter((c) => !isTerminalNm(c)).length
  const myOpenSubsidy = mySubsidy.filter((c) => !isTerminalSubsidy(c)).length

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Needs Attention"
          value={staleCount}
          tone={staleCount > 0 ? 'danger' : 'success'}
          hint={staleCount > 0 ? 'Cases stuck past the threshold' : 'Nothing overdue'}
        />
        <StatCard label="My Net Metering" value={myOpenNm} hint="Live applications" />
        <StatCard label="My Subsidy" value={myOpenSubsidy} hint="Live cases" />
        <StatCard
          label="My Tasks"
          value={tasks.filter((t) => t.status !== 'completed').length}
          hint="Assigned by the CEO or lead"
        />
      </div>

      <StaleCasesCard netMetering={myStaleNm} subsidy={myStaleSubsidy} scope="mine" />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="My net metering"
            subtitle="Longest-waiting first"
            action={<AllLink href="/discom/net-metering" />}
          />
          <NetMeteringMiniList items={myNm} emptyText="No net metering applications assigned to you." />
        </Card>

        <Card>
          <CardHeader
            title="My subsidy cases"
            subtitle="Longest-waiting first"
            action={<AllLink href="/discom/subsidy" />}
          />
          <SubsidyMiniList items={mySubsidy} emptyText="No subsidy cases assigned to you." />
        </Card>
      </div>

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

/** The lead's and CEO's view — the department, its stuck cases, and the handoff queue. */
async function TeamView({
  organizationId,
  netMetering,
  subsidy,
  canDelegate,
}: {
  organizationId: string
  netMetering: NetMeteringSummary
  subsidy: SubsidySummary
  canDelegate: boolean
}) {
  const departmentId = await getDiscomDepartmentId(organizationId)

  const [employees, unownedTasks, handoffs] = await Promise.all([
    getDiscomEmployees(organizationId),
    getUnownedDiscomTasks(organizationId, departmentId),
    getPendingHandoffs(organizationId),
  ])

  const inboxTasks = unownedTasks as unknown as AssignedTask[]
  const staleCount = netMetering.stale + subsidy.stale

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Needs Attention"
          value={staleCount}
          tone={staleCount > 0 ? 'danger' : 'success'}
          hint={staleCount > 0 ? 'Live cases stuck past the threshold' : 'Nothing overdue'}
        />
        <StatCard
          label="Pending Handoffs"
          value={handoffs.length}
          tone={handoffs.length > 0 ? 'warning' : 'default'}
          hint="Completed installs, no net metering yet"
        />
        <StatCard
          label="Open Cases"
          value={netMetering.open + subsidy.open}
          hint={`${netMetering.open} net metering · ${subsidy.open} subsidy`}
        />
        <StatCard
          label="Subsidy Disbursed"
          value={formatCurrency(subsidy.disbursedValue)}
          tone="brand"
          hint={`${subsidy.disbursed} cases paid out`}
        />
      </div>

      {canDelegate && inboxTasks.length > 0 && (
        <Card>
          <CardHeader
            title="Tasks awaiting delegation"
            subtitle="Assigned to DISCOM without a named owner. Delegating moves it to that person's dashboard."
          />
          <DepartmentTaskInbox
            tasks={inboxTasks}
            employees={employees}
            departmentName="DISCOM"
          />
        </Card>
      )}

      <StaleCasesCard
        netMetering={netMetering.all.filter((c) => c.isStale)}
        subsidy={subsidy.all.filter((c) => c.isStale)}
        scope="team"
      />

      <Card>
        <CardHeader
          title="Pending handoffs from O&M"
          subtitle="Installations marked complete with no net metering application started — the front of the queue."
        />
        <HandoffList items={handoffs} />
      </Card>
    </>
  )
}

/**
 * The staleness surface — the reason the module exists. Merges the stale net metering
 * and subsidy cases into one list, each row showing how long it has been stuck. Both
 * inputs already arrive longest-stuck-first, so a straight merge-and-resort keeps that
 * order across the two types.
 */
function StaleCasesCard({
  netMetering,
  subsidy,
  scope,
}: {
  netMetering: NetMeteringWithAging[]
  subsidy: SubsidyWithAging[]
  scope: 'mine' | 'team'
}) {
  const rows = [
    ...netMetering.map((c) => ({
      key: `nm:${c.id}`,
      href: `/discom/net-metering/${c.id}`,
      name: c.customer?.name ?? 'Unknown customer',
      statusLabel: NET_METERING_STATUS_LABELS[c.status],
      statusStyle: NET_METERING_STATUS_STYLES[c.status],
      kind: 'Net metering',
      days: c.daysInStatus,
      isStale: c.isStale,
    })),
    ...subsidy.map((c) => ({
      key: `subsidy:${c.id}`,
      href: `/discom/subsidy/${c.id}`,
      name: c.customer?.name ?? 'Unknown customer',
      statusLabel: SUBSIDY_STATUS_LABELS[c.status],
      statusStyle: SUBSIDY_STATUS_STYLES[c.status],
      kind: 'Subsidy',
      days: c.daysInStatus,
      isStale: c.isStale,
    })),
  ].sort((a, b) => b.days - a.days)

  return (
    <Card>
      <CardHeader
        title="Needs attention"
        subtitle={
          scope === 'mine'
            ? 'Your live cases stuck longest in one status.'
            : 'Live cases across the department stuck longest in one status.'
        }
      />
      {rows.length === 0 ? (
        <EmptyState
          title="Nothing stuck"
          description="No live case has sat past the staleness threshold. Everything is moving."
        />
      ) : (
        <ul className="divide-y divide-border-subtle">
          {rows.slice(0, 10).map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Link
                  href={r.href}
                  className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                >
                  {r.name}
                </Link>
                <p className="mt-0.5 flex items-center gap-2 text-xs text-text-muted">
                  <span>{r.kind}</span>
                  <Badge className={r.statusStyle}>{r.statusLabel}</Badge>
                </p>
              </div>
              <AgingBadge days={r.days} isStale={r.isStale} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function NetMeteringMiniList({
  items,
  emptyText,
}: {
  items: NetMeteringWithAging[]
  emptyText: string
}) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-text-muted">{emptyText}</p>
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 6).map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/discom/net-metering/${c.id}`}
              className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
            >
              {c.customer?.name ?? 'Unknown customer'}
            </Link>
            <p className="mt-0.5">
              <Badge className={NET_METERING_STATUS_STYLES[c.status]}>
                {NET_METERING_STATUS_LABELS[c.status]}
              </Badge>
            </p>
          </div>
          <AgingBadge days={c.daysInStatus} isStale={c.isStale} />
        </li>
      ))}
    </ul>
  )
}

function SubsidyMiniList({
  items,
  emptyText,
}: {
  items: SubsidyWithAging[]
  emptyText: string
}) {
  if (items.length === 0) {
    return <p className="px-5 py-8 text-center text-sm text-text-muted">{emptyText}</p>
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 6).map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <Link
              href={`/discom/subsidy/${c.id}`}
              className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
            >
              {c.customer?.name ?? 'Unknown customer'}
            </Link>
            <p className="mt-0.5">
              <Badge className={SUBSIDY_STATUS_STYLES[c.status]}>
                {SUBSIDY_STATUS_LABELS[c.status]}
              </Badge>
            </p>
          </div>
          <AgingBadge days={c.daysInStatus} isStale={c.isStale} />
        </li>
      ))}
    </ul>
  )
}

function HandoffList({ items }: { items: PendingHandoff[] }) {
  if (items.length === 0) {
    return (
      <EmptyState
        title="Nothing waiting"
        description="Every completed installation already has a net metering application started."
      />
    )
  }
  return (
    <ul className="divide-y divide-border-subtle">
      {items.slice(0, 8).map((h) => (
        <li key={h.id} className="flex items-center justify-between gap-3 px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-brand-slate">
              {h.customer?.name ?? 'Unknown customer'}
            </p>
            <p className="mt-0.5 text-xs text-text-muted">
              {h.address ?? 'No address'}
              {h.completed_date ? ` · completed ${formatDate(h.completed_date)}` : ''}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="text-xs text-text-muted" title="Waiting since completion">
              {formatDaysInStatus(h.daysWaiting)} waiting
            </span>
            <Link
              href={`/discom/net-metering/new?installation_id=${h.id}`}
              className="rounded-lg border border-border-subtle px-3 py-1.5 text-xs font-medium text-brand-slate transition-colors hover:border-brand-gold hover:text-brand-gold"
            >
              Start
            </Link>
          </div>
        </li>
      ))}
    </ul>
  )
}

function AllLink({ href }: { href: string }) {
  return (
    <Link href={href} className="text-xs font-medium text-brand-slate hover:text-brand-gold">
      All →
    </Link>
  )
}

function TabLink({ href, active, label }: { href: string; active: boolean; label: string }) {
  return (
    <Link href={href} aria-current={active ? 'page' : undefined} className={segmentClass(active)}>
      {label}
    </Link>
  )
}

function isTerminalNm(c: NetMeteringWithAging): boolean {
  return c.status === 'approved' || c.status === 'rejected'
}

function isTerminalSubsidy(c: SubsidyWithAging): boolean {
  return c.status === 'disbursed' || c.status === 'rejected'
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}
