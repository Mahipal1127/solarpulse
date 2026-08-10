import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { TenderForm } from '@/components/tender/TenderForm/TenderForm'
import { getTenderEmployees } from '@/lib/tender/queries'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import type { Tender } from '@/lib/types'

export default async function EditTenderPage(
  props: PageProps<'/tenders/[tenderId]/edit'>
) {
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, TENDER_DEPARTMENT_SLUG)) redirect('/tenders')

  const { tenderId } = await props.params
  const supabase = await createSupabaseServerClient()

  const [{ data: tender }, employees] = await Promise.all([
    supabase.from('tenders').select('*').eq('id', tenderId).maybeSingle(),
    getTenderEmployees(user.organization_id),
  ])

  // RLS already hides other orgs' rows, so invisible and non-existent are the
  // same 404 here.
  if (!tender) notFound()

  return (
    <div className="p-6">
      <div className="mb-6">
        <Link href={`/tenders/${tenderId}`} className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to tender
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Edit tender</h1>
        <p className="mt-1 text-sm text-text-muted">
          A past deadline is allowed here — a tender may be logged retroactively. Status changes
          happen on the detail page.
        </p>
      </div>

      <Card className="max-w-3xl p-6">
        <TenderForm mode="edit" tender={tender as Tender} employees={employees} />
      </Card>
    </div>
  )
}
