import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { SALES_DEPARTMENT_SLUG } from '@/lib/services/sales'

export interface SalesEmployee {
  id: string
  full_name: string
  role_name: string
}

/**
 * Active members of the Sales department, for assignee and target pickers.
 * Uses the session client so RLS still applies — an executive can read the
 * roster (they need it to see who a colleague is) but not that colleague's
 * pipeline.
 */
export async function getSalesEmployees(organizationId: string): Promise<SalesEmployee[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('users')
    .select('id, full_name, is_active, roles(name), departments!inner(slug)')
    .eq('organization_id', organizationId)
    .eq('is_active', true)
    .eq('departments.slug', SALES_DEPARTMENT_SLUG)
    .order('full_name')

  return (data ?? []).map((row) => {
    const role = row.roles as unknown as { name: string } | null
    return { id: row.id, full_name: row.full_name, role_name: role?.name ?? '' }
  })
}

/** The Sales department's id, needed to scope the CEO-assigned task queries. */
export async function getSalesDepartmentId(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', SALES_DEPARTMENT_SLUG)
    .maybeSingle()

  return data?.id ?? null
}
