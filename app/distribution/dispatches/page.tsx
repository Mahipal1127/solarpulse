import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/primitives'
import { DispatchList, type DispatchRow } from '@/components/distribution/DispatchList/DispatchList'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import { isDispatchRunningLate } from '@/lib/format'

export const dynamic = 'force-dynamic'

export default async function DispatchesPage() {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)

  const supabase = await createSupabaseServerClient()

  // material_dispatch_items(count) gives the line count without pulling every row.
  const { data } = await supabase
    .from('material_dispatches')
    .select(
      '*, lead:leads(id, name), dispatcher:users!material_dispatches_dispatched_by_fkey(full_name), items:material_dispatch_items(count)'
    )
    .eq('organization_id', user.organization_id)
    .order('created_at', { ascending: false })
    .limit(500)

  const dispatches = (data ?? []) as unknown as DispatchRow[]

  const inTransit = dispatches.filter((d) => d.status === 'in_transit')
  const preparing = dispatches.filter((d) => d.status === 'preparing')
  const late = dispatches.filter(isDispatchRunningLate)
  const delivered = dispatches.filter((d) => d.status === 'delivered')

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Dispatches</h1>
        <p className="mt-1 text-sm text-text-muted">
          Material on its way to site. Status is updated by hand as the lorry moves — there is no
          live vehicle tracking behind it.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Preparing" value={preparing.length} hint="Loaded but not left" />
        <StatCard label="In Transit" value={inTransit.length} />
        <StatCard
          label="Running Late"
          value={late.length}
          tone={late.length > 0 ? 'warning' : 'default'}
          hint="Longer in transit than expected"
        />
        <StatCard label="Delivered" value={delivered.length} tone="success" />
      </div>

      <DispatchList dispatches={dispatches} readOnly={readOnly} />
    </div>
  )
}
