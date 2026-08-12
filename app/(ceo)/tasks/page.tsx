import 'server-only'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, Badge, EmptyState } from '@/components/ui/primitives'
import { TaskFilters } from '@/components/ceo/TaskBoard/TaskFilters'
import { pillClass } from '@/components/shared/chrome'
import {
  formatDate,
  isOverdue,
  PRIORITY_BORDER,
  PRIORITY_LABELS,
  PRIORITY_STYLES,
  STATUS_DOT,
  STATUS_LABELS,
  STATUS_STYLES,
} from '@/lib/format'
import type { Task, Department, TaskStatus, TaskPriority } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * The CEO's task board.
 *
 * WHY THE COUNTS ARE THEIR OWN QUERIES
 * The list is capped at PAGE_SIZE rows. This page used to print `tasks.length` as
 * "N total", which meant an org with 350 tasks read "200 total" — a wrong number
 * stated confidently, and the overdue tally was computed from the same truncated
 * slice, so it under-reported exactly when it mattered most. Every figure shown here
 * now comes from an exact count over the whole filtered set, and when the list is
 * shorter than the count the page says so instead of quietly implying it is complete.
 *
 * STATUS LIVES IN THE PILL ROW, NOT THE DROPDOWN
 * The pills carry a count each, so the shape of the board is visible before any
 * filtering — which is the thing a dropdown cannot do. Status was therefore removed
 * from TaskFilters rather than duplicated: two controls writing one query param
 * disagree the moment either one is used.
 */

const PAGE_SIZE = 200

/**
 * Order the pills read in: the working statuses first, terminal ones after.
 *
 * Doubles as the allowlist for the `status` query param, so a status can never be
 * filterable without also being visible as a pill.
 */
const STATUS_ORDER: TaskStatus[] = [
  'pending',
  'in_progress',
  'delayed',
  'completed',
  'archived',
]

/** Allowlist for the `priority` query param. Ascending, matching the dropdown. */
const PRIORITIES: TaskPriority[] = ['low', 'medium', 'high', 'urgent']

type TaskRow = Task & {
  departments: { name: string } | null
  assignee: { full_name: string } | null
}

export default async function TasksPage(props: PageProps<'/tasks'>) {
  const user = await requireRole('CEO')
  const searchParams = await props.searchParams

  /*
   * Every filter below is validated before it reaches a query, because all three are
   * URL input and all three land in .eq() against a typed column. Postgres rejects an
   * invalid enum label or a malformed uuid outright, so ?status=foo or a truncated
   * department id would fail the whole read rather than filter it — the page would
   * render "nothing matches" for what is really a bad query. An unrecognised value is
   * dropped instead, which degrades to the unfiltered view.
   */
  const departmentFilter = asDepartmentId(asString(searchParams.department))
  const statusFilter = asEnum(asString(searchParams.status), STATUS_ORDER)
  const priorityFilter = asEnum(asString(searchParams.priority), PRIORITIES)
  const overdueOnly = asString(searchParams.overdue) === '1'

  const supabase = await createSupabaseServerClient()
  const nowISO = new Date().toISOString()

  /**
   * A head-only count over this org, narrowed by whatever department/priority the
   * user picked. Status is deliberately not applied: the pills partition *this* slice
   * by status, so folding the status filter in would leave every pill showing either
   * its own total or zero.
   *
   * A factory rather than a shared generic: each builder here selects a different
   * shape, and a helper covering all of them needs casts that throw away the type
   * checking that makes these queries safe to change.
   */
  const countQuery = () => {
    let q = supabase
      .from('tasks')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', user.organization_id)

    if (departmentFilter) q = q.eq('assigned_department_id', departmentFilter)
    if (priorityFilter) q = q.eq('priority', priorityFilter)

    /*
     * The overdue toggle narrows the pills too. Without this, turning on "Overdue
     * only" left "Pending 40" sitting above a list of five rows — the same
     * count-does-not-describe-the-list bug this rework exists to remove, just moved
     * out of the header and into the pills.
     */
    if (overdueOnly) {
      q = q.lt('due_date', nowISO).not('status', 'in', '(completed,archived)')
    }

    return q
  }

  const listQuery = () => {
    let query = supabase
      .from('tasks')
      .select(
        'id, title, status, priority, due_date, progress_percent, assigned_department_id, assigned_user_id, created_at, updated_at, organization_id, description, created_by, departments!tasks_assigned_department_id_fkey(name), assignee:users!tasks_assigned_user_id_fkey(full_name)',
        { count: 'exact' }
      )
      .eq('organization_id', user.organization_id)

    if (departmentFilter) query = query.eq('assigned_department_id', departmentFilter)
    if (priorityFilter) query = query.eq('priority', priorityFilter)

    if (statusFilter) {
      query = query.eq('status', statusFilter)
    } else {
      // Archived tasks are hidden unless explicitly asked for.
      query = query.neq('status', 'archived')
    }

    /*
     * Overdue is expressed in SQL here, not filtered in JS after the fact. Filtering
     * a truncated page would have shrunk the list without correcting the count, and
     * these two clauses are exactly isOverdue(): a due date in the past, on a task
     * that is neither completed nor archived. A null due_date fails `lt` and so is
     * excluded, which is the same answer isOverdue() gives.
     */
    if (overdueOnly) {
      query = query.lt('due_date', nowISO).not('status', 'in', '(completed,archived)')
    }

    return query
      .order('due_date', { ascending: true, nullsFirst: false })
      .limit(PAGE_SIZE)
  }

  /** Exact count for one status within the current department/priority slice. */
  const statusCount = (status: TaskStatus) => countQuery().eq('status', status)

  const [listRes, departmentRes, overdueRes, ...statusResults] = await Promise.all([
    listQuery(),

    supabase
      .from('departments')
      .select('id, name, slug, organization_id, parent_department_id, created_at')
      .eq('organization_id', user.organization_id)
      .order('name'),

    // Same two clauses as isOverdue(), so the header's tally and the row badges
    // cannot disagree.
    countQuery().lt('due_date', nowISO).not('status', 'in', '(completed,archived)'),

    ...STATUS_ORDER.map(statusCount),
  ])

  const departments = (departmentRes.data ?? []) as Department[]
  const tasks = (listRes.data ?? []) as unknown as TaskRow[]

  /** The whole filtered set, not the page. This is the number the header prints. */
  const matchingCount = listRes.count ?? tasks.length
  const truncated = matchingCount > tasks.length

  const overdueCount = overdueRes.count ?? 0
  const countByStatus = new Map(
    STATUS_ORDER.map((status, index) => [status, statusResults[index]?.count ?? 0])
  )
  // "All" excludes archived, matching what the unfiltered list shows.
  const activeTotal = STATUS_ORDER.filter((s) => s !== 'archived').reduce(
    (total, status) => total + (countByStatus.get(status) ?? 0),
    0
  )

  /** Preserves every other filter while changing one — pills must not reset the rest. */
  const withParam = (key: string, value: string | undefined) => {
    const params = new URLSearchParams()
    if (departmentFilter) params.set('department', departmentFilter)
    if (priorityFilter) params.set('priority', priorityFilter)
    if (statusFilter) params.set('status', statusFilter)
    if (overdueOnly) params.set('overdue', '1')

    if (value) params.set(key, value)
    else params.delete(key)

    const qs = params.toString()
    return qs ? `/tasks?${qs}` : '/tasks'
  }

  return (
    <div className="p-6 sm:p-8">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Tasks</h1>
          <p className="mt-1 text-sm text-text-muted">
            {matchingCount === 0
              ? 'Nothing matches these filters'
              : `${matchingCount} ${matchingCount === 1 ? 'task' : 'tasks'} match`}
            {overdueCount > 0 && !overdueOnly && (
              <>
                {' · '}
                <Link
                  href={withParam('overdue', '1')}
                  className="font-medium text-status-danger hover:underline"
                >
                  {overdueCount} overdue
                </Link>
              </>
            )}
          </p>
        </div>

        <Link
          href="/tasks/new"
          className="inline-flex items-center gap-1.5 rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
        >
          <Plus className="h-4 w-4" />
          New task
        </Link>
      </header>

      {/*
        Status pills, each carrying its own count. The counts are what make this worth
        the space over a dropdown — the board's shape is legible before you filter.
      */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href={withParam('status', undefined)} className={pillClass(!statusFilter)}>
          All <span className="ml-1 opacity-70">{activeTotal}</span>
        </Link>
        {STATUS_ORDER.map((status) => (
          <Link
            key={status}
            href={withParam('status', status)}
            className={pillClass(statusFilter === status)}
          >
            {STATUS_LABELS[status]}
            <span className="ml-1 opacity-70">{countByStatus.get(status) ?? 0}</span>
          </Link>
        ))}
      </div>

      <Card className="mb-6 p-4">
        <TaskFilters departments={departments} />
      </Card>

      <Card>
        {tasks.length === 0 ? (
          <EmptyState
            title="No tasks match these filters"
            description="Try clearing a filter, or create a new task to assign work to a department."
          />
        ) : (
          <>
            <ul className="divide-y divide-border-subtle">
              {tasks.map((task) => {
                const overdue = isOverdue(task)
                const status = task.status as TaskStatus
                const priority = task.priority as TaskPriority

                return (
                  <li key={task.id}>
                    <Link
                      href={`/tasks/${task.id}`}
                      className={`flex items-center gap-4 border-l-4 py-3.5 pl-4 pr-5 transition-colors hover:bg-surface-bg ${PRIORITY_BORDER[priority]}`}
                    >
                      {/* Status as a dot on the leading edge: scannable down the
                          column without reading the badge on every row. */}
                      <span
                        aria-hidden
                        className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`}
                      />

                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-medium text-brand-slate">
                            {task.title}
                          </h3>
                          {overdue && (
                            <Badge className="badge-danger">Overdue</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 truncate text-xs text-text-muted">
                          {[
                            task.departments?.name ?? 'Unassigned',
                            task.assignee?.full_name,
                            task.due_date ? `Due ${formatDate(task.due_date)}` : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                      </div>

                      {/*
                        Progress is read-only here and everywhere on the CEO side. Only
                        the assignee can author it — see the note in
                        lib/validation/schemas.ts. Shown as a number rather than a bar:
                        a row is scanned, and twenty bars read as a chart nobody meant
                        to draw.
                      */}
                      <span className="hidden w-10 shrink-0 text-right text-xs font-medium tabular-nums text-text-muted sm:block">
                        {task.progress_percent}%
                      </span>

                      <div className="hidden shrink-0 items-center gap-2 md:flex">
                        <Badge className={PRIORITY_STYLES[priority]}>
                          {PRIORITY_LABELS[priority]}
                        </Badge>
                        <Badge className={STATUS_STYLES[status]}>
                          {STATUS_LABELS[status]}
                        </Badge>
                      </div>
                    </Link>
                  </li>
                )
              })}
            </ul>

            {truncated && (
              <p className="border-t border-border-subtle px-5 py-3 text-xs text-text-muted">
                Showing the {tasks.length} soonest-due of {matchingCount} matching tasks.
                Narrow the filters to see the rest.
              </p>
            )}
          </>
        )}
      </Card>
    </div>
  )
}

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * Narrows a query param to one of a known set of values, dropping anything else.
 * Returning undefined rather than throwing is the point: a junk param degrades to
 * the unfiltered view instead of erroring a page the CEO is entitled to see.
 */
function asEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[]
): T | undefined {
  return allowed.includes(value as T) ? (value as T) : undefined
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Shape check only — whether the id names a real department in this org is RLS's
 * call, not this function's. It exists because `.eq()` on a uuid column with a
 * non-uuid string is a Postgres type error that fails the entire read, so a
 * malformed id has to be dropped before the query rather than after.
 */
function asDepartmentId(value: string | undefined): string | undefined {
  return value && UUID_PATTERN.test(value) ? value : undefined
}
