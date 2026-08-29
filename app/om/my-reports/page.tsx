import { requireDepartment } from '@/lib/auth/guards'
import { OM_DEPARTMENT_SLUG } from '@/lib/services/operations'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** An Operations & Maintenance employee's own report submissions. */
export default async function OMMyReportsPage() {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
