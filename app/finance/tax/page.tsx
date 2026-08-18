import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS, isFinanceMember } from '@/lib/services/finance'
import { getGstFilings, getTdsRecords } from '@/lib/finance/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { GstFilingForm } from '@/components/finance/GstFilingForm'
import { GstFilingList } from '@/components/finance/GstFilingList'
import { TdsRecordForm } from '@/components/finance/TdsRecordForm'
import { TdsRecordList } from '@/components/finance/TdsRecordList'

export const dynamic = 'force-dynamic'

/**
 * Tax — GST filings and TDS records on one page. GST output/input are pre-summed server-side
 * from invoices/bills; net_payable is DB-generated. TDS tracks deductions until deposited.
 * Forms render only for Finance members (write); a read-only viewer (CEO) sees the lists with
 * the inline actions dropped. This deliberately does NOT touch the GST portal or e-invoicing —
 * out of scope by design.
 */
export default async function TaxPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const canWrite = isFinanceMember(user)

  const [filings, tds] = await Promise.all([getGstFilings(), getTdsRecords()])

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Tax</h1>
        <p className="mt-1 text-sm text-text-muted">
          GST filings and TDS records. Figures are summed from your own invoices and bills — this
          is bookkeeping, not a connection to the GST portal.
        </p>
      </header>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">GST</h2>
        {canWrite && (
          <Card>
            <CardHeader
              title="Open a GST filing"
              subtitle="Leave amounts blank to sum them from the month's invoices and bills."
            />
            <div className="px-5 py-4">
              <GstFilingForm />
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Filings" subtitle={`${filings.length} shown`} />
          <GstFilingList filings={filings} readOnly={!canWrite} />
        </Card>
      </section>

      <section className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-text-muted">TDS</h2>
        {canWrite && (
          <Card>
            <CardHeader title="Record a TDS deduction" />
            <div className="px-5 py-4">
              <TdsRecordForm />
            </div>
          </Card>
        )}
        <Card>
          <CardHeader title="Deductions" subtitle={`${tds.length} shown`} />
          <TdsRecordList records={tds} readOnly={!canWrite} />
        </Card>
      </section>
    </div>
  )
}
