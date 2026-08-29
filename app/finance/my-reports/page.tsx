import { requireAnyDepartment } from '@/lib/auth/guards'
import { FINANCE_DEPARTMENT_SLUGS } from '@/lib/services/finance'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/**
 * A Finance or Accounts employee's own report submissions.
 *
 * requireAnyDepartment because Accounts is a child department of Finance and its staff
 * work the same module — the same pairing my-tasks uses.
 *
 * 'my-reports', not 'reports': /finance/reports is already the financial statements page.
 */
export default async function FinanceMyReportsPage() {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  return <MyReportsView user={user} />
}
