import Link from 'next/link'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { ContentCalendarView } from '@/components/marketing/ContentCalendarView'
import { AICalendarPanel } from '@/components/marketing/AICalendarPanel'
import { getContentItems } from '@/lib/marketing/dashboard'
import { MARKETING_DEPARTMENT_SLUG } from '@/lib/services/marketing'
import { listPlans } from '@/lib/services/marketing-creative'

export const dynamic = 'force-dynamic'

/** Current month as 'YYYY-MM' for the grid's initial cursor. */
function currentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * The content calendar — a month grid (the primary view) with a list toggle. RLS
 * scopes the items: an employee sees their own, a lead/CEO sees the department's.
 */
export default async function ContentCalendarPage() {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)

  const [items, plans] = await Promise.all([
    getContentItems(user.organization_id),
    listPlans(),
  ])

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Content Calendar</h1>
          <p className="mt-1 text-sm text-text-muted">
            Reels, posts and stories scheduled across the month. Items due and not yet posted are
            flagged.
          </p>
        </div>
        {!readOnly && (
          <Link
            href="/marketing/content-calendar/new"
            className="rounded-lg bg-brand-gold px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-orange"
          >
            New item
          </Link>
        )}
      </div>

      <AICalendarPanel plans={plans} readOnly={readOnly} />

      <ContentCalendarView items={items} initialMonth={currentMonth()} />
    </div>
  )
}
