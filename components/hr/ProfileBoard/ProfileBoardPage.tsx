import 'server-only'

import { notFound } from 'next/navigation'
import { Card } from '@/components/ui/primitives'
import { ProfileBoard } from './ProfileBoard'
import { ProfileHeader } from './ProfileHeader'
import { IDCardTab } from './IDCardTab'
import { DocumentsTab } from './DocumentsTab'
import { PerformanceSummaryPanel } from './PerformanceSummaryPanel'
import { getEmployeeProfile, getEmployeeDocuments, signHrObject } from '@/lib/hr/profile'
import { getPerformanceSummary, ServiceError } from '@/lib/services/performance'
import { isHrLead } from '@/lib/services/hr'
import type { SessionUser } from '@/lib/auth/guards'

/**
 * The complete Profile Board for one employee, assembled server-side and shared verbatim by the HR
 * route (/hr/employees/[id]) and the CEO route (/(ceo)/employees/[id]). Both routes do their own
 * department/role gate, then hand the resolved SessionUser here — so the board itself never
 * re-decides who may open it; it decides only what to SHOW, from the caller's entitlements.
 *
 *  - Profile + documents come back RLS-scoped (the caller sees only what the DB grants).
 *  - canManage (HR lead / CEO) unlocks the interactive ID-card controls.
 *  - The performance summary is the strict tier: fetched through getPerformanceSummary, which
 *    throws 403 for anyone but CEO / HR lead / the employee themselves. We catch that and pass
 *    null so the panel renders its locked notice — the figures never reach an unentitled page.
 */
export async function ProfileBoardPage({ user, employeeId }: { user: SessionUser; employeeId: string }) {
  const profile = await getEmployeeProfile(employeeId)
  if (!profile) notFound()

  const canManage = user.roleName === 'CEO' || isHrLead(user)

  const [documents, photoUrl, performance] = await Promise.all([
    getEmployeeDocuments(employeeId),
    signHrObject(profile.profilePhotoPath),
    getPerformanceSummary(user, employeeId).catch((err) => {
      // Only an entitlement 403 degrades to the locked panel; a real fault should surface.
      if (err instanceof ServiceError && err.status === 403) return null
      throw err
    }),
  ])

  return (
    <div className="space-y-6 p-6">
      <Card>
        <ProfileHeader profile={profile} photoUrl={photoUrl} />
      </Card>

      <Card>
        <ProfileBoard
          idCard={
            <IDCardTab
              profile={profile}
              organizationName={profile.organizationName}
              canManage={canManage}
            />
          }
          documents={<DocumentsTab documents={documents} />}
          performance={<PerformanceSummaryPanel summary={performance} />}
        />
      </Card>
    </div>
  )
}
