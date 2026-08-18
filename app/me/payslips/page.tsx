import { requireUser } from '@/lib/auth/guards'
import { listOwnPayslips } from '@/lib/services/hr'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { SALARY_STATUS_LABELS, SALARY_STATUS_STYLES, formatCurrency, formatDate } from '@/lib/format'

export const dynamic = 'force-dynamic'

/**
 * The signed-in employee's own payslips — the personal, company-wide payroll surface.
 * This reads salary data, so even though it is the caller's OWN pay, the read is logged
 * as sensitive in the service layer. Only finalized/paid records are shown; a draft the
 * HR lead is still preparing is not a payslip yet. net_payable is the DB-generated
 * figure, never recomputed here.
 */
export default async function MyPayslipsPage() {
  const user = await requireUser()
  const payslips = await listOwnPayslips(user)

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">My Payslips</h1>
        <p className="mt-1 text-sm text-text-muted">
          Your finalized salary records. Figures are as processed by HR.
        </p>
      </header>

      <Card>
        <CardHeader title="Payslips" />
        {payslips.length === 0 ? (
          <EmptyState
            title="No payslips yet"
            description="Once HR finalizes a salary record for you, it appears here."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-subtle text-left text-xs uppercase tracking-wide text-text-muted">
                  <th className="px-4 py-3 font-semibold">Month</th>
                  <th className="px-4 py-3 text-right font-semibold">Base</th>
                  <th className="px-4 py-3 text-right font-semibold">Bonus</th>
                  <th className="px-4 py-3 text-right font-semibold">Incentives</th>
                  <th className="px-4 py-3 text-right font-semibold">Deductions</th>
                  <th className="px-4 py-3 text-right font-semibold">Net payable</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {payslips.map((p) => (
                  <tr key={p.id} className="transition-colors hover:bg-surface-bg">
                    <td className="px-4 py-3 text-brand-slate">{formatDate(p.effective_month)}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(p.base_salary)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(p.bonus)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(p.incentives)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-text-muted">
                      {formatCurrency(p.deductions)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-brand-slate">
                      {formatCurrency(p.net_payable)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge className={SALARY_STATUS_STYLES[p.status]}>
                        {SALARY_STATUS_LABELS[p.status]}
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
