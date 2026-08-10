import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { TenderForm } from '@/components/tender/TenderForm/TenderForm'
import { getTenderEmployees } from '@/lib/tender/queries'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'

export default async function NewTenderPage() {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing for them here.
  if (isReadOnlyFor(user, TENDER_DEPARTMENT_SLUG)) redirect('/tenders')

  const employees = await getTenderEmployees(user.organization_id)

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href="/tenders" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to tenders
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Add tender</h1>
        <p className="mt-1 text-sm text-text-muted">
          Logged as open. The submission deadline drives the overdue flag across the module.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <TenderForm mode="create" employees={employees} />
      </Card>
    </div>
  )
}
