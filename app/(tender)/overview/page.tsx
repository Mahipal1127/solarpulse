import Link from 'next/link'
import { requireDepartment, isReadOnlyFor, isDepartmentManager } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, CardHeader, StatCard, EmptyState, Badge } from '@/components/ui/primitives'
import { MyTaskBoard, type AssignedTask } from '@/components/employee/MyTaskBoard'
import { DepartmentTaskInbox } from '@/components/shared/DepartmentTaskInbox'
import { TenderList } from '@/components/tender/TenderList/TenderList'
import {
  getTenderSummary,
  getBidSummary,
  getUnownedTenderTasks,
  CLOSING_SOON_DAYS,
  type TenderWithAssignee,
} from '@/lib/tender/dashboard'
import { getTenderEmployees, getTenderDepartmentId } from '@/lib/tender/queries'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import {
  formatCurrency,
  formatDate,
  deadlineCountdown,
  isOverdue,
  TENDER_STATUS_STYLES,
  TENDER_STATUS_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

const TASK_SELECT =
  '*, department:departments!tasks_assigned_department_id_fkey(name), creator:users!tasks_created_by_fkey(full_name)'

/**
 * The Tender department's dashboard.
 *
 * WHY THIS PAGE WAS ADDED
 * Sales, Distribution and Technical each land on a dashboard; Tender landed on
 * /my-tasks, which the sidebar even gave a LayoutDashboard icon — dressed as a
 * dashboard without being one. So the one question this department exists to answer,
 * "which deadline is about to pass", was only reachable by opening /tenders and
 * reading a list. A missed submission deadline is unrecoverable: the tender closes
 * and the work is gone. That deserves to be the first thing on screen.
 *
 * NO MINE/TEAM TABS, UNLIKE SALES AND TECHNICAL
 * Those two have a per-employee tier in RLS — an executive sees their own leads, an
 * engineer their own surveys — so a manager needs a toggle to widen the view. Tender
 * has no such tier: tender_dept_access_tenders (migration 0003) hands every active
 * member of the department the same rows, because a tender is departmental work
 * rather than one person's. Adding tabs here would imply a boundary that does not
 * exist. What *is* personal is the CEO's task assignments, and those have their own
 * section at the foot of the page.
 *
 * ORDER IS BY URGENCY, NOT BY MODULE STRUCTURE
 * Overdue first, then closing this week, then the counts, then the working queue.
 * The two attention panels are absent entirely when empty rather than rendering a
 * reassuring "nothing here" card — a dashboard whose top half is permanently empty
 * teaches people to scroll past it.
 *
 * READ-ONLY FOR THE CEO
 * requireDepartment admits them as it does everywhere, isReadOnlyFor marks it, and
 * assertCanWrite() in the tender service refuses every write from outside the
 * department regardless. Nothing on this page mutates a tender, so the flag only
 * governs whether the "Add tender" affordance appears.
 */
export default async function TenderOverviewPage() {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TENDER_DEPARTMENT_SLUG)
  const manager = isDepartmentManager(user)

  const supabase = await createSupabaseServerClient()

  const [tenders, bids, departmentId, taskResult] = await Promise.all([
    getTenderSummary(user.organization_id),
    getBidSummary(),
    getTenderDepartmentId(user.organization_id),
    supabase
      .from('tasks')
      .select(TASK_SELECT)
      .eq('assigned_user_id', user.id)
      .neq('status', 'archived')
      .order('due_date', { ascending: true, nullsFirst: false }),
  ])

  const myTasks = (taskResult.data ?? []) as unknown as AssignedTask[]

  /*
   * The delegation inbox and its dropdown are only fetched for the person who can
   * act on them. A manager delegates; everyone else has no use for either, and the
   * CEO is read-only here by design.
   */
  const canDelegate = manager && !readOnly
  const [unownedTasks, employees] = canDelegate
    ? await Promise.all([
        getUnownedTenderTasks(user.organization_id, departmentId),
        getTenderEmployees(user.organization_id),
      ])
    : [[], []]

  const inboxTasks = unownedTasks as unknown as AssignedTask[]

  const myOpenTasks = myTasks.filter((t) => t.status !== 'completed').length
  const myOverdueTasks = myTasks.filter(isOverdue).length

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            {readOnly ? 'Tender overview' : `Welcome back, ${firstName(user.full_name)}`}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            {readOnly
              ? 'Every tender the department is working on, and what is closing soonest.'
              : 'What closes soonest, what nobody has picked up, and the tasks assigned to you.'}
          </p>
        </div>

        {!readOnly && (
          <Link
            href="/tenders/new"
            className="shrink-0 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + Add tender
          </Link>
        )}
      </header>

      {/*
        Overdue sits above the stat cards, the same placement Technical gives its
        handoff queue. A tender past its deadline is the one thing on this page that
        represents work already lost rather than work outstanding, so it is not
        something to find by scrolling.
      */}
      {tenders.overdue.length > 0 && (
        <Card className="border-status-danger/30">
          <CardHeader
            title="Past the deadline"
            subtitle="Never submitted. The submission window has closed."
          />
          <DeadlineList tenders={tenders.overdue} />
        </Card>
      )}

      {tenders.closingSoon.length > 0 && (
        <Card className="border-brand-gold/40">
          <CardHeader
            title={`Closing within ${CLOSING_SOON_DAYS} days`}
            subtitle="Still open. These are the ones to work on now."
          />
          <DeadlineList tenders={tenders.closingSoon} />
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Active Tenders"
          value={tenders.active}
          tone={tenders.overdue.length > 0 ? 'danger' : 'default'}
          hint={
            tenders.overdue.length > 0
              ? `${tenders.overdue.length} past deadline`
              : `${tenders.total} logged in total`
          }
        />
        <StatCard
          label="Unassigned"
          value={tenders.unassigned.length}
          tone={tenders.unassigned.length > 0 ? 'warning' : 'default'}
          hint="Active, with nobody named"
        />
        <StatCard
          label="Bids In Play"
          value={bids.inPlay}
          hint={`${formatCurrency(bids.valueInPlay)} excluding lost`}
        />
        <StatCard
          label="Pipeline Value"
          value={formatCurrency(tenders.pipelineValue)}
          hint={tenders.won > 0 ? `${tenders.won} won · ${formatCurrency(tenders.wonValue)}` : 'Estimated, active only'}
        />
      </div>

      {/*
        Said once, and only when it is true. Every count above is computed in JS over
        a capped read, so at the cap they describe what was read rather than what
        exists — and a figure that silently understates the department's workload is
        worse than one that admits its own limit.
      */}
      {(tenders.capped || bids.capped) && (
        <p className="text-xs text-text-muted">
          Showing the most recent records only — the figures above cover what could be
          read in one page, not the full history.
        </p>
      )}

      {canDelegate && (
        <Card>
          <CardHeader
            title="Tasks awaiting delegation"
            subtitle="Assigned to Tender by the CEO without a named owner. Delegating moves it to that person's dashboard."
          />
          <DepartmentTaskInbox
            tasks={inboxTasks}
            employees={employees}
            departmentName="Tender"
          />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Next deadlines"
            subtitle="Active tenders, soonest first"
            action={
              <Link
                href="/tenders"
                className="text-xs font-medium text-brand-slate hover:text-brand-slate"
              >
                All tenders →
              </Link>
            }
          />
          <TenderList
            tenders={tenders.upcoming}
            compact
            emptyTitle="Nothing active"
            emptyDescription={
              readOnly
                ? 'Tenders logged by the Tender department will appear here.'
                : 'Add a tender to start tracking a submission deadline.'
            }
          />
        </Card>

        <Card>
          <CardHeader
            title="Bids"
            subtitle="Where the department's submissions stand"
            action={
              <Link
                href="/bids"
                className="text-xs font-medium text-brand-slate hover:text-brand-slate"
              >
                All bids →
              </Link>
            }
          />
          {bids.total === 0 ? (
            <EmptyState
              title="No bids yet"
              description="Bids are created from a tender's detail page."
            />
          ) : (
            <div className="space-y-3 px-5 py-4">
              <BidRow label="Draft" value={bids.draft} />
              <BidRow label="In play" value={bids.inPlay} hint="Submitted or under review" />
              <BidRow label="Won" value={bids.won} tone="success" />
              <BidRow label="Lost" value={bids.lost} />
              <div className="flex items-center justify-between border-t border-border-subtle pt-3">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                  Value won
                </p>
                <p className="text-sm font-semibold text-brand-slate">
                  {formatCurrency(bids.wonValue)}
                </p>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/*
        Personal work last. It is the one section on this page that is about the
        individual rather than the department, and on a shared board the departmental
        deadlines outrank it.
      */}
      {!readOnly && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-brand-slate">My assigned tasks</h2>
              <p className="mt-0.5 text-xs text-text-muted">
                Assigned by the CEO. Progress updates save live and are visible to them
                immediately.
              </p>
            </div>
            {myOpenTasks > 0 && (
              <p className="shrink-0 text-xs text-text-muted">
                {myOpenTasks} open
                {myOverdueTasks > 0 && (
                  <span className="ml-1 font-medium text-status-danger">
                    · {myOverdueTasks} past due
                  </span>
                )}
              </p>
            )}
          </div>
          <MyTaskBoard initialTasks={myTasks} userId={user.id} />
        </section>
      )}
    </div>
  )
}

/**
 * A deadline-first row. Deliberately not TenderList: that component leads with the
 * title and puts the countdown third, which is right for browsing a list and wrong
 * for a panel whose entire purpose is the date. Here the countdown is the headline.
 */
function DeadlineList({ tenders }: { tenders: TenderWithAssignee[] }) {
  return (
    <ul className="divide-y divide-border-subtle">
      {tenders.slice(0, 6).map((tender) => {
        const countdown = deadlineCountdown(tender)

        return (
          <li key={tender.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Link
                href={`/tenders/${tender.id}`}
                className="min-w-0 flex-1 text-sm font-medium text-brand-slate hover:underline"
              >
                <span className="truncate">{tender.title}</span>
              </Link>
              <div className="flex shrink-0 items-center gap-2">
                <Badge className={TENDER_STATUS_STYLES[tender.status]}>
                  {TENDER_STATUS_LABELS[tender.status]}
                </Badge>
                {tender.estimated_value !== null && (
                  <span className="text-xs font-semibold text-text-muted">
                    {formatCurrency(tender.estimated_value)}
                  </span>
                )}
              </div>
            </div>
            <p className="mt-0.5 text-xs text-text-muted">
              {countdown && <span className="font-medium text-status-danger">{countdown}</span>}
              {countdown && ' · '}
              Due {formatDate(tender.submission_deadline)}
              {' · '}
              {tender.assignee?.full_name ?? 'Unassigned'}
            </p>
          </li>
        )
      })}
    </ul>
  )
}

function BidRow({
  label,
  value,
  hint,
  tone,
}: {
  label: string
  value: number
  hint?: string
  tone?: 'success'
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
        {hint && <p className="text-xs text-text-muted/70">{hint}</p>}
      </div>
      <p
        className={`text-lg font-semibold ${
          tone === 'success' ? 'text-status-success' : 'text-brand-slate'
        }`}
      >
        {value}
      </p>
    </div>
  )
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}
