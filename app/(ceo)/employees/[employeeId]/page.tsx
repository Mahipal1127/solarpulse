import { requireRole } from '@/lib/auth/guards'
import { ProfileBoardPage } from '@/components/hr/ProfileBoard/ProfileBoardPage'

export const dynamic = 'force-dynamic'

/**
 * The CEO's view of an employee's Profile Board — the SAME board component HR uses, so the two
 * views never drift. The CEO gate is requireRole('CEO'); as a full-access viewer the CEO gets card
 * management and the performance summary, scoped to their own organization by RLS.
 */
export default async function CeoEmployeeProfilePage(
  props: PageProps<'/employees/[employeeId]'>
) {
  const user = await requireRole('CEO')
  const { employeeId } = await props.params

  return <ProfileBoardPage user={user} employeeId={employeeId} />
}
