import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { SubsidyForm } from '@/components/discom/SubsidyForm'
import { getCompletedInstallations } from '@/lib/discom/queries'
import { getDiscomEmployees } from '@/lib/discom/dashboard'
import { DISCOM_DEPARTMENT_SLUG } from '@/lib/services/discom'

export const dynamic = 'force-dynamic'

export default async function NewSubsidyPage() {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing for them here.
  if (isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)) redirect('/discom/subsidy')

  const [installations, liaisons] = await Promise.all([
    getCompletedInstallations(user.organization_id),
    getDiscomEmployees(user.organization_id),
  ])

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/discom/subsidy" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to subsidy
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">New subsidy case</h1>
        <p className="mt-1 text-sm text-text-muted">
          Opens from a completed installation. It starts as Not Started — record each status change
          as the claim progresses, so the time-in-status clock stays accurate.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <SubsidyForm installations={installations} liaisons={liaisons} />
      </Card>
    </div>
  )
}
