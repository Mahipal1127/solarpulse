import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { StatCard } from '@/components/ui/primitives'
import { VendorList } from '@/components/distribution/VendorList/VendorList'
import { DISTRIBUTION_DEPARTMENT_SLUG } from '@/lib/services/distribution'
import { MATERIAL_CATEGORIES } from '@/lib/distribution/constants'
import type { Vendor } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function VendorsPage() {
  const user = await requireDepartment(DISTRIBUTION_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)

  const supabase = await createSupabaseServerClient()

  // Inactive vendors are fetched too, not filtered out here: the list offers a
  // toggle for them so a soft-deleted vendor can be found and reinstated. Which
  // rows come back at all is RLS's decision — every Distribution member sees the
  // whole department's vendor book, there is no per-employee tier in this module.
  const { data } = await supabase
    .from('vendors')
    .select('*')
    .eq('organization_id', user.organization_id)
    .order('is_active', { ascending: false })
    .order('name', { ascending: true })
    .limit(500)

  const vendors = (data ?? []) as Vendor[]
  const active = vendors.filter((v) => v.is_active)
  const categories = new Set(active.map((v) => v.category).filter(Boolean))

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-brand-slate">Vendors</h1>
        <p className="mt-1 text-sm text-text-muted">
          Suppliers you raise purchase orders against. Vendor payments are Finance&apos;s — this is
          the record of who supplies what.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatCard label="Active Vendors" value={active.length} />
        <StatCard
          label="Categories Covered"
          value={categories.size}
          hint={`of ${MATERIAL_CATEGORIES.length} material categories`}
        />
        <StatCard
          label="Inactive"
          value={vendors.length - active.length}
          hint="Deactivated, still on historical orders"
        />
      </div>

      <VendorList vendors={vendors} readOnly={readOnly} />
    </div>
  )
}
