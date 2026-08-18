import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { Card } from '@/components/ui/primitives'
import { ContentItemForm } from '@/components/marketing/ContentItemForm'
import { getMarketingEmployees } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'

export const dynamic = 'force-dynamic'

export default async function NewContentItemPage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)

  // The CEO's access to this module is read-only; there is nothing for them here.
  if (isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)) redirect('/marketing/content-calendar')

  const employees = await getMarketingEmployees(user.organization_id)

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link
          href="/marketing/content-calendar"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to calendar
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">New content item</h1>
        <p className="mt-1 text-sm text-text-muted">
          Schedule a reel, post or story and assign it to whoever will produce it.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <ContentItemForm employees={employees} />
      </Card>
    </div>
  )
}
