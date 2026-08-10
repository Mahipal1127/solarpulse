import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card, StatCard } from '@/components/ui/primitives'
import { ReturnList, type ReturnRow } from '@/components/distribution/ReturnList/ReturnList'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'

export const dynamic = 'force-dynamic'

export default async function ReturnsPage() {
  // Distribution and the CEO. Deliberately no Sales read on returns: a return is
  // Distribution and Store's business, and the cross-department policy stops at
  // dispatches and allocations.
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)

  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('material_returns')
    .select(
      '*, dispatch:material_dispatches(id, dispatch_number), lead:leads(id, name), returner:users!material_returns_returned_by_fkey(full_name)'
    )
    .eq('organization_id', user.organization_id)
    .order('created_at', { ascending: false })
    .limit(500)

  const returns = (data ?? []) as unknown as ReturnRow[]

  const pending = returns.filter((r) => r.status === 'pending')
  const received = returns.filter((r) => r.status === 'received_by_store')
  const damaged = returns.filter((r) => r.condition !== 'good')

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Material Returns</h1>
        <p className="mt-1 text-sm text-text-muted">
          Material coming back from site — excess, damaged, or sent in error.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Total Returns" value={returns.length} />
        <StatCard
          label="Awaiting Check-in"
          value={pending.length}
          tone={pending.length > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Received" value={received.length} tone="success" />
        <StatCard
          label="Damaged or Unusable"
          value={damaged.length}
          tone={damaged.length > 0 ? 'danger' : 'default'}
        />
      </div>

      {/**
       * Stated in the UI rather than only in a code comment, because the button
       * says "Mark received" and someone will reasonably assume Store pressed it.
       * TODO: replace with Store's own confirmation once that module exists.
       */}
      <Card className="border-status-warning/25 bg-status-warning/5 px-5 py-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-status-warning">
          Interim process
        </p>
        <p className="mt-1.5 text-sm text-status-warning">
          Checking returned material in is really Store&apos;s job, and the Store module does not
          exist yet. Until it does, Distribution records the check-in itself and the audit trail
          notes that it was self-confirmed rather than signed for by Store.
        </p>
      </Card>

      <ReturnList returns={returns} readOnly={readOnly} />
    </div>
  )
}
