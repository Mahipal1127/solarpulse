import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/primitives'
import {
  MaterialAllocationBoard,
  type AllocationRow,
} from '@/components/distribution/MaterialAllocationBoard/MaterialAllocationBoard'
import { AllocationFormPanel } from '@/components/distribution/MaterialAllocationBoard/AllocationFormPanel'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'

export const dynamic = 'force-dynamic'

export default async function AllocationsPage() {
  // Distribution and the CEO only. Finance has no reason to see material planning,
  // and RLS gives them nothing here either way.
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)

  const supabase = await createSupabaseServerClient()

  const [{ data: allocationData }, { data: projectData }] = await Promise.all([
    supabase
      .from('material_allocations')
      .select(
        '*, lead:leads(id, name), dispatch:material_dispatches(id, dispatch_number, status)'
      )
      .eq('organization_id', user.organization_id)
      .order('created_at', { ascending: false })
      .limit(500),
    // Projects to allocate against. distribution_read_won_leads exposes closed-won
    // leads only, so this list is already the right shape — the status filter here
    // is belt and braces, and would be doing nothing if the policy is correct.
    supabase
      .from('leads')
      .select('id, name')
      .eq('organization_id', user.organization_id)
      .eq('status', 'won')
      .order('updated_at', { ascending: false })
      .limit(200),
  ])

  const allocations = (allocationData ?? []) as unknown as AllocationRow[]
  const projects = (projectData ?? []) as { id: string; name: string }[]

  const pending = allocations.filter((a) => a.status === 'allocated')
  const dispatched = allocations.filter((a) => a.status === 'dispatched')
  const projectCount = new Set(allocations.map((a) => a.lead_id)).size

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-brand-slate">Material Allocation</h1>
          <p className="mt-1 text-sm text-text-muted">
            What is earmarked for which project. A plan and a commitment, not a warehouse count —
            stock levels are Store&apos;s to own.
          </p>
        </div>

        {!readOnly && <AllocationFormPanel projects={projects} />}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Projects" value={projectCount} hint="With material allocated" />
        <StatCard
          label="Awaiting Dispatch"
          value={pending.length}
          tone={pending.length > 0 ? 'warning' : 'default'}
        />
        <StatCard label="Dispatched" value={dispatched.length} tone="success" />
        <StatCard label="Line Items" value={allocations.length} />
      </div>

      <MaterialAllocationBoard allocations={allocations} readOnly={readOnly} />
    </div>
  )
}
