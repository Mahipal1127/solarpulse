import { requireRole } from '@/lib/auth/guards'
import { Card, CardHeader } from '@/components/ui/primitives'
import { EmployeeDirectory } from '@/components/ceo/EmployeeDirectory/EmployeeDirectory'
import { getEmployeeDirectory } from '@/lib/hr/profile'

export const dynamic = 'force-dynamic'

/**
 * The CEO's org-wide employee directory. Every row links to the shared Profile Board and carries a
 * task-completion indicator over the trailing 30 days. CEO-only (requireRole); RLS scopes the read
 * to the CEO's organization.
 */
export default async function CeoEmployeesPage() {
  await requireRole('CEO')
  const entries = await getEmployeeDirectory()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Employees</h1>
        <p className="mt-1 text-sm text-text-muted">
          Everyone across the company. Open a profile for their ID card, documents, and performance.
        </p>
      </header>

      <Card>
        <CardHeader title="Directory" subtitle={`${entries.length} people`} />
        <div className="px-5 py-4">
          <EmployeeDirectory entries={entries} />
        </div>
      </Card>
    </div>
  )
}
