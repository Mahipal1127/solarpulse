import { requireDepartment } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** A Marketing & Training employee's own report submissions. */
export default async function MarketingMyReportsPage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
