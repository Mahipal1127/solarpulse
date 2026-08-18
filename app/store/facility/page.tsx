import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { getFacilityLogs } from '@/lib/store/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { FacilityLog } from '@/components/store/FacilityLog/FacilityLog'
import { FacilityIssueForm } from '@/components/store/FacilityLog/FacilityIssueForm'

export const dynamic = 'force-dynamic'

/**
 * Facility management — a lightweight open/in-progress/resolved issue log for the office and
 * store premises. Reporting is an inline field; status moves inline on each row.
 */
export default async function FacilityPage() {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, STORE_DEPARTMENT_SLUG)
  const logs = await getFacilityLogs()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Facility</h1>
        <p className="mt-1 text-sm text-text-muted">
          Office and premises issues. Log one, then move it through to resolved.
        </p>
      </header>

      <Card>
        <CardHeader title="Issues" subtitle={`${logs.length} logged`} />
        {!readOnly && (
          <div className="border-b border-border-subtle bg-surface-bg">
            <FacilityIssueForm />
          </div>
        )}
        <FacilityLog logs={logs} readOnly={readOnly} />
      </Card>
    </div>
  )
}
