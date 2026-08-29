import { requireDepartment } from '@/lib/auth/guards'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** A DISCOM employee's own report submissions. */
export default async function DiscomMyReportsPage() {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
