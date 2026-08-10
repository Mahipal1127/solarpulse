import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'

export interface TenderEmployee {
  id: string
  full_name: string
}

/**
 * Active users in the Tender department. Every assignee dropdown in this module
 * is scoped to this list, and the service layer re-checks membership on write —
 * the dropdown is convenience, not the constraint.
 */
export async function getTenderEmployees(organizationId: string): Promise<TenderEmployee[]> {
  const supabase = await createSupabaseServerClient()

  const { data: department } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', TENDER_DEPARTMENT_SLUG)
    .maybeSingle()

  if (!department) return []

  const { data } = await supabase
    .from('users')
    .select('id, full_name')
    .eq('organization_id', organizationId)
    .eq('department_id', department.id)
    .eq('is_active', true)
    .order('full_name')

  return (data ?? []) as TenderEmployee[]
}

/** Resolves the Tender department's id for this org, or null if unseeded. */
export async function getTenderDepartmentId(organizationId: string): Promise<string | null> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('departments')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('slug', TENDER_DEPARTMENT_SLUG)
    .maybeSingle()

  return data?.id ?? null
}
