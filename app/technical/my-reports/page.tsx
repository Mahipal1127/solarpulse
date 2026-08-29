import { requireDepartment } from '@/lib/auth/guards'
import { TECHNICAL_DEPARTMENT_SLUG } from '@/lib/services/technical'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/**
 * A Technical employee's own report submissions.
 *
 * Not to be confused with the "Report" button in the module header, which raises an IT
 * SUPPORT TICKET and is org-wide. This is the employee's own periodic work report.
 */
export default async function TechnicalMyReportsPage() {
  const user = await requireDepartment(TECHNICAL_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
