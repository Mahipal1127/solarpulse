import Link from 'next/link'
import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead, listRecentSalaryRecords } from '@/lib/services/hr'
import { getEmployeeRoster } from '@/lib/hr/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { SalaryRecordForm } from '@/components/hr/SalaryRecordForm'
import { SALARY_STATUS_LABELS, SALARY_STATUS_STYLES, formatCurrency, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * Payroll — SENSITIVE TIER. Salary is the most restricted data in the system: only the
 * HR lead and the CEO see anyone else's pay, and a plain HR Executive sees none of it.
 *
 * The gate is server-side and the sensitive content is rendered OUT ENTIRELY for an
 * unauthorized viewer — not hidden with CSS. Nothing below the `if (!lead)` return ever
 * reaches the browser for a regular HR Executive: no salary figures, no form, no roster
 * with pay attached. This is the deliberate distinction the module is built around, and
 * it is backed by RLS (0015) and the service-layer sensitive-tier checks — the frontend
 * omission is defence-in-depth, never the sole control.
 */
export default async function PayrollPage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const lead = isHrLead(user)

  // A regular HR Executive (or anyone not on the sensitive tier) gets a notice and
  // NOTHING else. The salary data is never fetched, so it cannot leak through the page.
  if (!lead) {
    return (
      <div className="space-y-6 p-6">
        <header>
          <h1 className="text-2xl font-semibold text-brand-slate">Payroll</h1>
        </header>
        <Card>
          <EmptyState
            title="Restricted"
            description="Salary information is visible only to the HR lead and CEO. If you need a payroll change, raise it with your HR lead."
          />
        </Card>
      </div>
    )
  }

  const [records, roster] = await Promise.all([
    listRecentSalaryRecords(user),
    getEmployeeRoster(),
  ])

  const activeRoster = roster
    .filter((e) => e.employment_status !== 'exited')
    .map((e) => ({ employee_id: e.employee_id, full_name: e.full_name }))

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Payroll</h1>
        <p className="mt-1 text-sm text-text-muted">
          Salary records by month. Net payable is computed from the parts — it is never entered by
          hand. Every view of this data is logged.
        </p>
      </header>

      <Card>
        <CardHeader title="New salary record" />
        <div className="px-5 py-4">
          <SalaryRecordForm employees={activeRoster} />
        </div>
      </Card>

      <Card>
        <CardHeader title="Recent records" subtitle={`${records.length} shown`} />
        {records.length === 0 ? (
          <EmptyState title="No salary records yet" description="Records you create appear here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Employee</th>
                  <th className="px-4 py-3 font-semibold">Month</th>
                  <th className="px-4 py-3 text-right font-semibold">Base</th>
                  <th className="px-4 py-3 text-right font-semibold">Bonus</th>
                  <th className="px-4 py-3 text-right font-semibold">Incentives</th>
                  <th className="px-4 py-3 text-right font-semibold">Deductions</th>
                  <th className="px-4 py-3 text-right font-semibold">Net</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {records.map((r) => (
                  <tr key={r.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3">
                      <Link
                        href={`/hr/employees/${r.employee_id}`}
                        className="text-brand-slate hover:text-brand-gold hover:underline"
                      >
                        {r.employeeName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-text-muted">{formatDate(r.effective_month)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(r.base_salary)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(r.bonus)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(r.incentives)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(r.deductions)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(r.net_payable)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={SALARY_STATUS_STYLES[r.status]}>
                        {SALARY_STATUS_LABELS[r.status]}
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
