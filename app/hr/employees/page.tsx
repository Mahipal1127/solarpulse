import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { getEmployeeRoster } from '@/lib/hr/dashboard'
import { Card, CardHeader, Badge, EmptyState } from '@/components/ui/primitives'
import { ExitControl } from '@/components/hr/ExitControl'
import { EMPLOYMENT_STATUS_LABELS, EMPLOYMENT_STATUS_STYLES } from '@/lib/format'
import type { EmploymentStatus } from '@/lib/types'

export const dynamic = 'force-dynamic'

/**
 * Employee management — the roster, onboarding (HR lead / CEO), and exit processing.
 * Onboarding is the full wizard (details, photo, documents, review) that provisions the
 * login + users + employees rows and the ID card together; exit is the atomic teardown.
 * Non-salary personnel fields only — pay and appraisals live in their own gated pages.
 */
export default async function EmployeesPage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, HR_DEPARTMENT_SLUG)
  const lead = isHrLead(user)

  const roster = await getEmployeeRoster()

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Employees</h1>
        <p className="mt-1 text-sm text-text-muted">
          The people roster across the company. Onboarding and exits are handled by the HR lead.
        </p>
      </header>

      {lead && (
        <Card>
          <CardHeader
            title="Onboard employee"
            subtitle="Creates their login, profile, documents, and ID card together"
            action={
              <Link
                href="/hr/onboarding/new"
                className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
              >
                Start onboarding →
              </Link>
            }
          />
          <div className="px-5 py-4">
            <p className="text-sm text-text-muted">
              The onboarding wizard walks through the new hire&apos;s details, photo, and documents,
              then provisions their account and generates the ID card in one step.
            </p>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title="Roster" subtitle={`${roster.length} people`} />
        {roster.length === 0 ? (
          <EmptyState title="No employees yet" description="Onboarded employees appear here." />
        ) : (
          <div className="divide-y divide-border-subtle">
            {roster.map((e) => (
              <div key={e.employee_id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link
                      href={`/hr/employees/${e.employee_id}`}
                      className="font-medium text-brand-slate hover:text-brand-gold hover:underline"
                    >
                      {e.full_name}
                    </Link>
                    <p className="mt-0.5 text-xs text-text-muted">
                      {e.designation ?? 'No designation'}
                      {e.department_name ? ` · ${e.department_name}` : ''}
                    </p>
                  </div>
                  <Badge className={EMPLOYMENT_STATUS_STYLES[e.employment_status as EmploymentStatus]}>
                    {EMPLOYMENT_STATUS_LABELS[e.employment_status as EmploymentStatus] ??
                      e.employment_status}
                  </Badge>
                </div>

                {lead && !readOnly && e.employment_status !== 'exited' && (
                  <ExitControl employeeId={e.employee_id} employeeName={e.full_name} />
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  )
}
