import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { getKpis, getEmployeeRoster } from '@/lib/hr/dashboard'
import { getTeamPerformanceOverview } from '@/lib/services/performance'
import { Card, CardHeader, Badge, EmptyState, StatCard } from '@/components/ui/primitives'
import { KpiForm } from '@/components/hr/KpiForm'
import { AppraisalForm } from '@/components/hr/AppraisalForm'
import { TeamPerformanceTable } from '@/components/hr/TeamPerformanceTable'
import { KPI_STATUS_LABELS, KPI_STATUS_STYLES, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

/** Trailing windows offered by the period selector. */
const PERIOD_OPTIONS = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const

/**
 * Performance — KPIs and appraisals.
 *
 * KPIs are set by the HR lead / CEO and read by the employee (their own, via RLS); the
 * overview list here shows what the caller can see. APPRAISALS are SENSITIVE TIER, as
 * private as pay: the appraisal form is only rendered for the HR lead / CEO and is
 * omitted entirely otherwise — not CSS-hidden. A plain HR Executive can set/see KPIs
 * they are permitted but never authors an appraisal here.
 *
 * Appraisal RECORDS are not listed in this general overview on purpose: an appraisal is
 * read on the individual employee's profile under RLS, not laid out in a department-wide
 * table, so a stray join here cannot expose one review to the wrong reader.
 */
export default async function PerformancePage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>
}) {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const lead = isHrLead(user)
  // Detailed team analytics are strict tier: the HR lead and the CEO only (the service enforces
  // the same rule). A plain HR Executive still sets/sees KPIs, but not the whole-team board.
  const canViewAnalytics = lead || user.roleName === 'CEO'

  const { period } = await searchParams
  const requested = Number(period)
  const periodDays = PERIOD_OPTIONS.some((o) => o.days === requested) ? requested : 30

  const [kpis, roster, overview] = await Promise.all([
    getKpis(),
    lead ? getEmployeeRoster() : Promise.resolve([]),
    canViewAnalytics
      ? getTeamPerformanceOverview(user, periodDays)
      : Promise.resolve(null),
  ])

  const activeRoster = roster
    .filter((e) => e.employment_status !== 'exited')
    .map((e) => ({ employee_id: e.employee_id, full_name: e.full_name }))

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Performance</h1>
        <p className="mt-1 text-sm text-text-muted">
          Team analytics, KPIs, and appraisals. Analytics and appraisals are visible only to the HR
          lead and CEO.
        </p>
      </header>

      {overview && (
        <Card>
          <CardHeader
            title="Team analytics"
            subtitle={`${overview.totals.people} active ${overview.totals.people === 1 ? 'person' : 'people'} · trailing ${overview.periodDays} days`}
            action={
              <div className="flex gap-1">
                {PERIOD_OPTIONS.map((o) => (
                  <Link
                    key={o.days}
                    href={`/hr/performance?period=${o.days}`}
                    scroll={false}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      o.days === overview.periodDays
                        ? 'bg-brand-slate text-white'
                        : 'border border-border-subtle text-text-muted hover:bg-surface-bg'
                    }`}
                  >
                    {o.label}
                  </Link>
                ))}
              </div>
            }
          />
          <div className="space-y-5 px-5 py-5">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatCard
                label="Task completion"
                value={overview.totals.completionRate === null ? '—' : `${overview.totals.completionRate}%`}
                hint={`${overview.totals.tasksCompleted}/${overview.totals.tasksAssigned} tasks`}
                tone="brand"
              />
              <StatCard label="Present days" value={overview.totals.present} hint="across the team" />
              <StatCard
                label="Absent / leave"
                value={`${overview.totals.absent} / ${overview.totals.onLeave}`}
                hint="days"
                tone={overview.totals.absent > 0 ? 'warning' : 'default'}
              />
              <StatCard label="Hours worked" value={overview.totals.totalHours} hint="closed shifts" />
            </div>

            <TeamPerformanceTable rows={overview.rows} />
          </div>
        </Card>
      )}

      {lead && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Set KPI" />
            <div className="px-5 py-4">
              <KpiForm employees={activeRoster} />
            </div>
          </Card>
          <Card>
            <CardHeader title="Record appraisal" subtitle="Sensitive — HR lead and CEO only" />
            <div className="px-5 py-4">
              <AppraisalForm employees={activeRoster} />
            </div>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="KPIs" subtitle={`${kpis.length} shown`} />
        {kpis.length === 0 ? (
          <EmptyState title="No KPIs yet" description="KPIs you can see appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">KPI</th>
                  <th className="px-4 py-3 font-semibold">Period</th>
                  <th className="px-4 py-3 font-semibold">Target</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {kpis.map((k) => (
                  <tr key={k.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3">
                      <Link
                        href={`/hr/employees/${k.employee_id}`}
                        className="text-brand-slate hover:text-brand-gold hover:underline"
                      >
                        {k.employee?.full_name ?? '—'}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-brand-slate">{k.kpi_description}</td>
                    <td className="px-4 py-3 text-text-muted">
                      {formatDate(k.period_start)} – {formatDate(k.period_end)}
                    </td>
                    <td className="px-4 py-3 text-text-muted">{k.target_value ?? '—'}</td>
                    <td className="px-4 py-3">
                      <Badge className={KPI_STATUS_STYLES[k.status]}>
                        {KPI_STATUS_LABELS[k.status]}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}
