import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Picker data for the Rooftop forms. Runs on the session client; the
 * rooftop_read_customers policy (0026) is what lets this department read
 * Sales' customers at all.
 */

export interface CustomerOption {
  id: string
  name: string
  address: string | null
}

/** Customers in the org, for the new-site form's customer picker. */
export async function getCustomerOptions(organizationId: string): Promise<CustomerOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('customers')
    .select('id, name, address')
    .eq('organization_id', organizationId)
    .order('name')
    .limit(1000)

  return (data ?? []) as CustomerOption[]
}
