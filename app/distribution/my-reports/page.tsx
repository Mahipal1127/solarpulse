import { requireDepartment } from '@/lib/auth/guards'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** A Distribution employee's own report submissions. */
export default async function DistributionMyReportsPage() {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
