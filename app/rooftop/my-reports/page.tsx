import { requireDepartment } from '@/lib/auth/guards'
import { ROOFTOP_DEPARTMENT_SLUG } from '@/lib/services/rooftop'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** A Rooftop employee's own report submissions. */
export default async function RooftopMyReportsPage() {
  const user = await requireDepartment(ROOFTOP_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
