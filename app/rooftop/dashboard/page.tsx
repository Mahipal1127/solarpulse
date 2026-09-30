import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card, CardHeader, StatCard, Badge, EmptyState } from '@/components/ui/primitives'
import { getRooftopSummary, getRecentRooftopUpdates } from '@/lib/rooftop/dashboard'
import { ROOFTOP_DEPARTMENT_SLUG } from '@/lib/services/rooftop'
import {
  formatDateTime,
  ROOFTOP_STATUS_STYLES,
  ROOFTOP_STATUS_LABELS,
  ROOFTOP_UPDATE_KIND_STYLES,
  ROOFTOP_UPDATE_KIND_LABELS,
} from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * A Rooftop person's day: which sites have work live right now, what was
 * just logged across all of them, and the department's footprint in kW.
 *
 * There is deliberately no mine/team toggle here, unlike Sales/Technical/O&M:
 * monitoring is the department's collective job (0026 gives every member the
 * same row visibility), so the dashboard is one shared picture. The CEO lands
 * here read-only.
 */
export default async function RooftopDashboardPage() {
  const user = await requireDepartment(ROOFTOP_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, ROOFTOP_DEPARTMENT_SLUG)

  const [summary, updates] = await Promise.all([
    getRooftopSummary(user.organization_id),
    getRecentRooftopUpdates(8),
  ])

  const liveSites = summary.all.filter((p) => p.status === 'active').slice(0, 6)

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">
            Welcome back, {firstName(user.full_name)}
          </h1>
          <p className="mt-1 text-sm text-text-muted">
            Every customer site the Rooftop department monitors — live work, held work and done
            work.
          </p>
        </div>
        {!readOnly && (
          <Link
            href="/rooftop/projects/new"
            className="rounded-lg bg-brand-gold px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-orange"
          >
            + Add site
          </Link>
        )}
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Live sites" value={summary.active} hint="Work happening now" />
        <StatCard
          label="On Hold"
          value={summary.onHold}
          tone={summary.onHold > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Completed"
          value={summary.completed}
          tone={summary.completed > 0 ? 'success' : 'default'}
        />
        <StatCard
          label="Monitored capacity"
          value={`${summary.totalCapacityKw.toLocaleString('en-IN')} kW`}
          hint={`${summary.all.length} site${summary.all.length === 1 ? '' : 's'} tracked`}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Live right now"
            subtitle="Customer sites with work in progress"
            action={
              <Link
                href="/rooftop/projects"
                className="text-sm font-medium text-brand-gold hover:underline"
              >
                All sites
              </Link>
            }
          />
          {liveSites.length === 0 ? (
            <EmptyState
              title="No live sites"
              description="When a customer site enters monitoring it appears here."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {liveSites.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 px-5 py-3">
                  <div className="min-w-0">
                    <Link
                      href={`/rooftop/projects/${p.id}`}
                      className="truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                    >
                      {p.customer?.name ?? 'Unknown customer'}
                    </Link>
                    <p className="truncate text-xs text-text-muted">
                      {[p.site_city, p.site_state].filter(Boolean).join(', ') || p.site_address}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {Number(p.capacity_kw ?? 0) > 0 && (
                      <span className="hidden text-xs text-text-muted sm:inline">
                        {Number(p.capacity_kw).toLocaleString('en-IN')} kW
                      </span>
                    )}
                    <Badge className={ROOFTOP_STATUS_STYLES[p.status]}>
                      {ROOFTOP_STATUS_LABELS[p.status]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Latest site updates"
            subtitle="What was just logged, across all sites"
          />
          {updates.length === 0 ? (
            <EmptyState
              title="Nothing logged yet"
              description="Open a site and log what is happening — the feed fills from there."
            />
          ) : (
            <ul className="divide-y divide-border-subtle">
              {updates.map((u) => (
                <li key={u.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-3">
                    <Link
                      href={u.project ? `/rooftop/projects/${u.project.id}` : '/rooftop/projects'}
                      className="min-w-0 flex-1 truncate text-sm font-medium text-brand-slate hover:text-brand-gold"
                    >
                      {u.project?.customer?.name ?? 'Site update'}
                    </Link>
                    <Badge className={ROOFTOP_UPDATE_KIND_STYLES[u.kind]}>
                      {ROOFTOP_UPDATE_KIND_LABELS[u.kind]}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-sm text-text-muted">{u.note}</p>
                  <p className="mt-1 text-xs text-text-muted">
                    {u.author?.full_name ?? 'Unknown'} · {formatDateTime(u.created_at)}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function firstName(fullName: string): string {
  return fullName.split(' ')[0] || fullName
}

