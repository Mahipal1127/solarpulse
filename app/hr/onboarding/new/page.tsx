import { redirect } from 'next/navigation'
import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { getActiveUsers, getRoleOptions } from '@/lib/hr/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { OnboardingWizard } from '@/components/hr/OnboardingWizard/OnboardingWizard'

export const dynamic = 'force-dynamic'

/**
 * The full onboarding wizard — HR lead / CEO only. Onboarding provisions a login, so it is the
 * lead's action, not general HR-member work; a non-lead is redirected back to the roster. The
 * simpler inline OnboardEmployeeForm on /hr/employees stays for quick adds without a photo/card.
 */
export default async function OnboardingWizardPage() {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  if (!isHrLead(user) && user.roleName !== 'CEO') redirect('/hr/employees')

  const [roles, users] = await Promise.all([getRoleOptions(), getActiveUsers()])

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Onboard employee</h1>
        <p className="mt-1 text-sm text-text-muted">
          Create their login, profile, and digital ID card in one flow.
        </p>
      </header>

      <Card>
        <CardHeader title="New employee" subtitle="Details, photo, then review" />
        <div className="px-5 py-5">
          <OnboardingWizard roles={roles} users={users} />
        </div>
      </Card>
    </div>
  )
}
