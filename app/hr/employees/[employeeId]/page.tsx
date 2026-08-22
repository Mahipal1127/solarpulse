import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG } from '@/lib/services/hr'
import { ProfileBoardPage } from '@/components/hr/ProfileBoard/ProfileBoardPage'

export const dynamic = 'force-dynamic'

/**
 * HR's view of an employee's Profile Board. The HR-department gate is the outer check; the board
 * decides what to show from the caller's entitlements (an HR member sees the card image and
 * documents; the HR lead / CEO also get card management and the performance summary).
 */
export default async function HrEmployeeProfilePage(props: PageProps<'/hr/employees/[employeeId]'>) {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const { employeeId } = await props.params

  return <ProfileBoardPage user={user} employeeId={employeeId} />
}
