import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'

/**
 * Picker data for the O&M forms. Every query runs on the session client, so the
 * cross-department read policies added in 0012 (om_read_customers,
 * om_read_deal_closures) are what let O&M staff see these rows at all — nothing
 * here widens access, it only shapes what the policies already return.
 */

export interface CustomerOption {
  id: string
  name: string
  address: string | null
}

/** Customers in the org, for the installation / ticket / AMC customer pickers. */
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

export interface ConvertibleDeal {
  id: string
  final_amount: number
  closed_at: string
  customer: { id: string; name: string } | null
}

/**
 * Closed deals that do not yet have an installation, for the conversion picker.
 *
 * "Not yet converted" is computed here rather than in SQL: supabase-js has no clean
 * NOT IN (subquery), so we read the closures and the deal_closure_ids already on
 * installations, and subtract. A closure with no customer_id is skipped — the
 * conversion RPC needs one to stamp the installation's customer.
 */
export async function getConvertibleDeals(organizationId: string): Promise<ConvertibleDeal[]> {
  const supabase = await createSupabaseServerClient()

  const [{ data: closures }, { data: installs }] = await Promise.all([
    supabase
      .from('deal_closures')
      .select('id, final_amount, closed_at, customer:customers!inner(id, name)')
      .order('closed_at', { ascending: false })
      .limit(500),
    supabase
      .from('installations')
      .select('deal_closure_id')
      .eq('organization_id', organizationId)
      .not('deal_closure_id', 'is', null)
      .limit(1000),
  ])

  const taken = new Set((installs ?? []).map((r) => r.deal_closure_id as string))

  return ((closures ?? []) as unknown as ConvertibleDeal[])
    .filter((c) => c.customer !== null && !taken.has(c.id))
    .map((c) => ({ ...c, final_amount: Number(c.final_amount) }))
}

export interface InstallationOption {
  id: string
  address: string | null
  customer: { name: string } | null
}

/**
 * Installations visible to the caller, for linking a ticket or AMC to a site.
 * RLS decides which come back — a technician sees only theirs — which is fine: you
 * would only link a ticket to a site you can see.
 */
export async function getInstallationOptions(
  organizationId: string
): Promise<InstallationOption[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('installations')
    .select('id, address, customer:customers(name)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(500)

  return (data ?? []) as unknown as InstallationOption[]
}
