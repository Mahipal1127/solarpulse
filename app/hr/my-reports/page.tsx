import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** An HR employee's own report submissions. */
export default async function HrMyReportsPage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
