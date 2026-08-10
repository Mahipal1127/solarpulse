import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import {
  ReturnForm,
  type ReturnableDispatch,
} from '@/components/distribution/ReturnForm/ReturnForm'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'

export const dynamic = 'force-dynamic'

export default async function NewReturnPage(props: PageProps<'/distribution/returns/new'>) {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)) redirect('/distribution/returns')

  // Arrives from the "Log a return" link on a delivered dispatch.
  const { dispatch } = await props.searchParams
  const initialDispatchId = typeof dispatch === 'string' ? dispatch : undefined

  const supabase = await createSupabaseServerClient()

  /**
   * Delivered and delayed dispatches only. Material has to have reached site
   * before it can come back, so offering a 'preparing' dispatch would be
   * nonsense — but 'delayed' is included because a delayed lorry can still have
   * been unloaded and had material sent straight back.
   *
   * The nested items are what the form's prefill picker offers, so a returned line
   * matches how it was described going out.
   */
  const { data } = await supabase
    .from('material_dispatches')
    .select(
      'id, dispatch_number, lead_id, lead:leads(name), items:material_dispatch_items(item_name, category, unit)'
    )
    .eq('organization_id', user.organization_id)
    .in('status', ['delivered', 'delayed'])
    .order('delivered_at', { ascending: false, nullsFirst: false })
    .limit(200)

  const dispatches = (data ?? []) as unknown as ReturnableDispatch[]

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link href="/distribution/returns" className="text-xs text-text-muted hover:text-brand-slate">
          ← Back to returns
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Log a return</h1>
        <p className="mt-1 text-sm text-text-muted">
          One item per return, so quantities and condition stay accurate per line.
        </p>
      </div>

      <Card className="max-w-3xl px-5 py-5">
        <ReturnForm dispatches={dispatches} initialDispatchId={initialDispatchId} />
      </Card>
    </div>
  )
}
