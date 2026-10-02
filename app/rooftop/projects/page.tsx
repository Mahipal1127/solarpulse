import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { pillClass } from '@/components/shared/chrome'
import { getRooftopCounts, listRooftopProjects } from '@/lib/rooftop/dashboard'
import { ROOFTOP_DEPARTMENT_SLUG } from '@/lib/services/rooftop'
import {
  formatDate,
  ROOFTOP_STATUS_STYLES,
  ROOFTOP_STATUS_LABELS,
} from '@/lib/format'
import type { RooftopProjectStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

const FILTERS: Array<{ key: RooftopProjectStatus | 'all'; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Live' },
  { key: 'on_hold', label: 'On Hold' },
  { key: 'completed', label: 'Completed' },
  { key: 'cancelled', label: 'Cancelled' },
]

function asString(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0]
  return value
}

/**
 * The department's monitoring board — every customer site, filterable by
 * status. "Where is work live and where is it done" is the filter row, not a
 * separate page. The CEO sees the same list read-only.
 */
export default async function RooftopProjectsPage(
  props: PageProps<'/rooftop/projects'>
) {
  const user = await requireDepartment(ROOFTOP_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, ROOFTOP_DEPARTMENT_SLUG)
  const searchParams = await props.searchParams

  const raw = asString(searchParams.status) ?? 'all'
  const filter = (FILTERS.find((f) => f.key === raw)?.key ?? 'all') as
    | RooftopProjectStatus
    | 'all'

  // Two reads, not one: the tiles come from head-counts that transfer no rows,
  // and the list is narrowed by a WHERE clause — so choosing "Completed" filters
  // the query rather than a capped page of results that could silently lie.
  const [counts, projects] = await Promise.all([
    getRooftopCounts(user.organization_id),
    listRooftopProjects(user.organization_id, filter === 'all' ? undefined : filter),
  ])

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Sites</h1>
          <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-text-muted">
            <span>{counts.total} total</span>
            <span>·</span>
            <span>{counts.active} live</span>
            <span>·</span>
            <span>{counts.completed} done</span>
          </div>
        </div>
        {!readOnly && (
          <Link
            href="/rooftop/projects/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + Add site
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live" value={counts.active} hint="Work happening now" />
        <StatCard
          label="On Hold"
          value={counts.onHold}
          tone={counts.onHold > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Completed"
          value={counts.completed}
          tone={counts.completed > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Cancelled"
          value={counts.cancelled}
          tone={counts.cancelled > 0 ? 'warning' : 'default'}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key === 'all' ? '/rooftop/projects' : `/rooftop/projects?status=${f.key}`}
            className={pillClass(filter === f.key)}
          >
            {f.label}
          </Link>
        ))}
      </div>

      <Card>
        {projects.length === 0 ? (
          <EmptyState
            title={filter === 'all' ? 'No sites yet' : `No ${ROOFTOP_STATUS_LABELS[filter as RooftopProjectStatus].toLowerCase()} sites`}
            description={
              readOnly
                ? 'The Rooftop department has not added a site yet.'
                : 'Add a customer site to start tracking what is happening on it.'
            }
          />
        ) : (
          <ul className="divide-y divide-border-subtle">
            {projects.map((p) => (
              <li key={p.id}>
                <Link
                  href={`/rooftop/projects/${p.id}`}
                  className="flex flex-col gap-2 px-5 py-4 transition-colors hover:bg-surface-bg sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-brand-slate">
                      {p.customer?.name ?? 'Unknown customer'}
                    </p>
                    <p className="truncate text-xs text-text-muted">
                      {[p.site_address, p.site_city, p.site_state, p.site_pincode]
                        .filter(Boolean)
                        .join(', ')}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:shrink-0">
                    {p.customer?.phone && (
                      <span className="text-xs text-text-muted">{p.customer.phone}</span>
                    )}
                    {Number(p.capacity_kw ?? 0) > 0 && (
                      <span className="text-xs text-text-muted">
                        {Number(p.capacity_kw).toLocaleString('en-IN')} kW
                      </span>
                    )}
                    {p.go_live_date && (
                      <span className="text-xs text-text-muted">
                        Go-live {formatDate(p.go_live_date)}
                      </span>
                    )}
                    <Badge className={ROOFTOP_STATUS_STYLES[p.status]}>
                      {ROOFTOP_STATUS_LABELS[p.status]}
                    </Badge>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
