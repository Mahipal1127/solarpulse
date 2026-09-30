import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { RooftopProject, RooftopSiteUpdate } from '@/lib/types'

/**
 * Read shapes for the Rooftop module's dashboard and list pages. Every query
 * runs on the session client, so the policies added in 0026
 * (rooftop_member/lead/ceo access, rooftop_read_customers) are what let these
 * rows come back at all — nothing here widens access, it only shapes what the
 * policies already return.
 */

export interface RooftopProjectWithContext extends RooftopProject {
  customer: { id: string; name: string; phone: string | null; email: string | null; address: string | null } | null
}

export interface RooftopSummary {
  /** Every project RLS returned, for callers that group or filter rather than count. */
  all: RooftopProjectWithContext[]
  active: number
  onHold: number
  completed: number
  cancelled: number
  /** Sum of capacity_kw across every non-cancelled site, in kW. */
  totalCapacityKw: number
}

export async function getRooftopSummary(organizationId: string): Promise<RooftopSummary> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('rooftop_projects')
    .select('*, customer:customers(id, name, phone, email, address)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1000)

  const all = (data ?? []) as unknown as RooftopProjectWithContext[]

  return {
    all,
    active: all.filter((p) => p.status === 'active').length,
    onHold: all.filter((p) => p.status === 'on_hold').length,
    completed: all.filter((p) => p.status === 'completed').length,
    cancelled: all.filter((p) => p.status === 'cancelled').length,
    totalCapacityKw: all
      .filter((p) => p.status !== 'cancelled')
      .reduce((sum, p) => sum + Number(p.capacity_kw ?? 0), 0),
  }
}

export interface RooftopRecentUpdate extends RooftopSiteUpdate {
  author: { full_name: string } | null
  project:
    | {
        id: string
        site_address: string
        site_city: string | null
        status: RooftopProject['status']
        customer: { id: string; name: string } | null
      }
    | null
}

/** The latest entries across every site's work log, for the dashboard feed. */
export async function getRecentRooftopUpdates(limit = 8): Promise<RooftopRecentUpdate[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('rooftop_site_updates')
    .select(
      `*,
       author:users!rooftop_site_updates_updated_by_fkey(full_name),
       project:rooftop_projects(
         id, site_address, site_city, status,
         customer:customers(id, name)
       )`
    )
    .order('created_at', { ascending: false })
    .limit(limit)

  return (data ?? []) as unknown as RooftopRecentUpdate[]
}
