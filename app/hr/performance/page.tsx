import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { getKpis, getEmployeeRoster } from '@/lib/hr/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { KpiForm } from '@/components/hr/KpiForm'
import { AppraisalForm } from '@/components/hr/AppraisalForm'
import { KPI_STATUS_LABELS, KPI_STATUS_STYLES, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

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
export default async function PerformancePage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const lead = isHrLead(user)

  const [kpis, roster] = await Promise.all([getKpis(), lead ? getEmployeeRoster() : Promise.resolve([])])

  const activeRoster = roster
    .filter((e) => e.employment_status !== 'exited')
    .map((e) => ({ employee_id: e.employee_id, full_name: e.full_name }))

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Performance</h1>
        <p className="mt-1 text-sm text-text-muted">
          KPIs and appraisals. Appraisals are visible only to the HR lead and CEO.
        </p>
      </header>

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
