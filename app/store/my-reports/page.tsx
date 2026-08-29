import { requireDepartment } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG } from '@/lib/store/constants'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** A Store employee's own report submissions. Same board every module gets. */
export default async function StoreMyReportsPage() {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
