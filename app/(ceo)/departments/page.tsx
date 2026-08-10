import Link from 'next/link'
import { requireRole } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, EmptyState, Badge } from '@/components/ui/primitives'
import { formatDate } from '@/lib/format'
import type { Department, DepartmentReport } from '@/lib/types'

export default async function DepartmentsPage() {
  const user = await requireRole('CEO')
  const supabase = await createSupabaseServerClient()

  const [{ data: departmentData }, { data: reportData }] = await Promise.all([
    supabase
      .from('departments')
      .select('id, name, slug, organization_id, parent_department_id, created_at')
      .eq('organization_id', user.organization_id)
      .order('name'),
    supabase
      .from('department_reports')
      .select('id, department_id, report_date, summary, tasks_completed, tasks_pending, tasks_delayed, created_at')
      .order('report_date', { ascending: false })
      .limit(500),
  ])

  const departments = (departmentData ?? []) as Department[]
  const reports = (reportData ?? []) as DepartmentReport[]

  // Reports come back newest-first, so the first hit per department is the latest.
  const latestByDepartment = new Map<string, DepartmentReport>()
  for (const report of reports) {
    if (!latestByDepartment.has(report.department_id)) {
      latestByDepartment.set(report.department_id, report)
    }
  }

  /*
   * These cards used to carry a per-department coloured header strip, cycling
   * through eight hues. The palette has four status colours and a brand accent, none
   * of which mean "this is the Sales department", so the strip is gone rather than
   * recoloured: a department card is passive chrome, and gold is reserved for state
   * and action. Identity now comes from the initials tile and the name.
   */

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-brand-slate">Departments</h1>
        <p className="mt-1 text-sm text-text-muted">
          Daily rollups published by each department module.
        </p>
      </div>

      {departments.length === 0 ? (
        <Card>
          <EmptyState title="No departments configured" />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {departments.map((department, i) => {
            const report = latestByDepartment.get(department.id)
            const initials = department.name
              .split(' ')
              .map((w) => w[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()

            return (
              <Link key={department.id} href={`/departments/${department.id}`}>
                <div className="group h-full overflow-hidden rounded-lg border border-border-subtle bg-surface-card transition-colors hover:border-brand-gold/50">
                  <div className="border-b border-border-subtle px-5 py-4">
                    <div className="flex items-center justify-between">
                      {/* Same treatment as the sidebar logo mark, for consistency. */}
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-slate text-sm font-bold text-white">
                        {initials}
                      </div>
                      <span className="badge-neutral inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset">
                        {report ? formatDate(report.report_date) : 'No report'}
                      </span>
                    </div>
                    <p className="mt-3 text-base font-semibold text-brand-slate">
                      {department.name}
                    </p>
                    {department.parent_department_id && (
                      <p className="text-xs text-text-muted">Sub-department</p>
                    )}
                  </div>

                  {/* Body */}
                  <div className="px-5 py-4">
                    {report ? (
                      <>
                        <div className="grid grid-cols-3 gap-3 text-center">
                          <MetricBox label="Done" value={report.tasks_completed} color="text-status-success" bg="bg-status-success/5" />
                          <MetricBox label="Pending" value={report.tasks_pending} color="text-text-muted" bg="bg-surface-bg" />
                          <MetricBox label="Delayed" value={report.tasks_delayed} color="text-status-danger" bg="bg-status-danger/5" />
                        </div>
                        {report.summary && (
                          <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-text-muted">
                            {report.summary}
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-4 text-center">
                        <p className="text-xs text-text-muted/60">
                          Awaiting first report from this module.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

function MetricBox({
  label,
  value,
  color,
  bg,
}: {
  label: string
  value: number
  color: string
  bg: string
}) {
  return (
    <div className={`rounded-lg ${bg} px-2 py-2`}>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
      <p className="text-xs text-text-muted">{label}</p>
    </div>
  )
}
