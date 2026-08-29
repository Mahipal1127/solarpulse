import { requireDepartment } from '@/lib/auth/guards'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { MyReportsView } from '@/components/employee/MyReportsView'

export const dynamic = 'force-dynamic'

/** A Tender employee's own report submissions. */
export default async function TenderMyReportsPage() {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  return <MyReportsView user={user} />
}
