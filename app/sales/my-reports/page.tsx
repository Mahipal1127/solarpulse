import { requireDepartment } from '@/lib/auth/guards'
import { SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/**
 * A Sales employee's own report submissions.
 *
 * 'my-reports', not 'reports': /sales/reports is already the Sales BUSINESS report page
 * (pipeline, conversion, targets). Two different things, deliberately different routes.
 */
export default async function SalesMyReportsPage() {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
