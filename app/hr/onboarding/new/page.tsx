import { redirect } from 'next/navigation'
import { requireDepartment } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { getActiveUsers, getRoleOptions } from '@/lib/hr/dashboard'
import { Card, CardHeader } from '@/components/ui/primitives'
import { OnboardingWizard } from '@/components/hr/OnboardingWizard/OnboardingWizard'

export const dynamic = 'force-dynamic'

/**
 * The onboarding wizard — HR lead / CEO only, and now the single way to onboard. Provisioning
 * a login is the lead's action, not general HR-member work; a non-lead is redirected back to the
 * roster. (The old quick-add OnboardEmployeeForm was removed — it created an account with no
 * photo, documents, or card, which was never the meaningful path.)
 */
export default async function OnboardingWizardPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string; email?: string; phone?: string; designation?: string }>
}) {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  if (!isHrLead(user) && user.roleName !== 'CEO') redirect('/hr/employees')

  const [roles, users, params] = await Promise.all([
    getRoleOptions(),
    getActiveUsers(),
    searchParams,
  ])

  // Prefills carried over from a hired candidate's "Onboard" shortcut on the recruitment
  // board. All optional — a direct visit has none. The role is never prefilled: it is a real
  // roles FK the lead picks, whereas the candidate's applied_for_role is free text and seeds
  // the designation instead.
  const prefill = {
    fullName: params.name ?? '',
    email: params.email ?? '',
    phone: params.phone ?? '',
    designation: params.designation ?? '',
  }

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold text-brand-slate">Onboard employee</h1>
        <p className="mt-1 text-sm text-text-muted">
          Create their login, profile, and digital ID card in one flow.
        </p>
      </header>

      <Card>
        <CardHeader title="New employee" subtitle="Details, photo, documents, then review" />
        <div className="px-5 py-5">
          <OnboardingWizard roles={roles} users={users} prefill={prefill} />
        </div>
      </Card>
    </div>
  )
}
