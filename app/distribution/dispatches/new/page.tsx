import Link from 'next/link'
import { redirect } from 'next/navigation'
import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { Card } from '@/components/ui/primitives'
import { DispatchForm } from '@/components/distribution/DispatchForm/DispatchForm'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import type { MaterialAllocation } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function NewDispatchPage(props: PageProps<'/distribution/dispatches/new'>) {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  if (isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)) redirect('/distribution/dispatches')

  // Arrives from the allocation board's per-project "Dispatch material" link, so
  // the form opens with that project's allocations already listed.
  const { lead } = await props.searchParams
  const initialLeadId = typeof lead === 'string' ? lead : undefined

  const supabase = await createSupabaseServerClient()

  const [{ data: allocationData }, { data: projectData }] = await Promise.all([
    // Only unfulfilled allocations. One already dispatched must not be offered
    // again — create_dispatch_from_allocations() rejects it anyway, with a row lock
    // so two concurrent dispatches cannot both claim it, but there is no reason to
    // show someone a choice that will fail.
    supabase
      .from('material_allocations')
      .select('*, lead:leads(id, name)')
      .eq('organization_id', user.organization_id)
      .eq('status', 'allocated')
      .order('created_at', { ascending: true })
      .limit(500),
    supabase
      .from('leads')
      .select('id, name')
      .eq('organization_id', user.organization_id)
      .eq('status', 'won')
      .order('updated_at', { ascending: false })
      .limit(200),
  ])

  const allocations = (allocationData ?? []) as unknown as (MaterialAllocation & {
    lead: { id: string; name: string } | null
  })[]
  const projects = (projectData ?? []) as { id: string; name: string }[]

  return (
    <div className="space-y-6 p-6">
      <div>
        <Link
          href="/distribution/dispatches"
          className="text-xs text-text-muted hover:text-brand-slate"
        >
          ← Back to dispatches
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-brand-slate">Create a dispatch</h1>
        <p className="mt-1 text-sm text-text-muted">
          Fulfil what was allocated to a project, add unplanned items, or both. Selected allocations
          are marked dispatched in the same transaction as the dispatch itself.
        </p>
      </div>

      <Card className="px-5 py-5">
        <DispatchForm
          projects={projects}
          allocations={allocations}
          initialLeadId={initialLeadId}
        />
      </Card>
    </div>
  )
}
