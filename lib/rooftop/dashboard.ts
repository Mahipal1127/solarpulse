import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { RooftopProject, RooftopProjectStatus, RooftopSiteUpdate } from '@/lib/types'

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

export interface RooftopCounts {
  total: number
  active: number
  onHold: number
  completed: number
  cancelled: number
  /** Sum of capacity_kw across every non-cancelled site, in kW. */
  totalCapacityKw: number
}

/**
 * The monitoring board's tiles, without transferring the rows behind them.
 *
 * Counts run with `head: true`, so Postgres counts and returns no rows at all —
 * four index-only counts rather than pulling every project (with its customer
 * join) just to call `.length`. This is what makes the board's numbers correct
 * rather than capped: `.reduce` over a 1000-row page would misreport an org with
 * more sites than that.
 *
 * The capacity sum has no aggregate available through PostgREST, so it reads
 * only the capacity_kw column — no customer join — and adds up in JS, the same
 * shape every other module's summary uses.
 */
export async function getRooftopCounts(organizationId: string): Promise<RooftopCounts> {
  const supabase = await createSupabaseServerClient()

  const countFor = (status?: RooftopProjectStatus) => {
    const query = supabase
      .from('rooftop_projects')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
    return status ? query.eq('status', status) : query
  }

  const [total, active, onHold, completed, cancelled, capacity] = await Promise.all([
    countFor(),
    countFor('active'),
    countFor('on_hold'),
    countFor('completed'),
    countFor('cancelled'),
    supabase
      .from('rooftop_projects')
      .select('capacity_kw')
      .eq('organization_id', organizationId)
      .neq('status', 'cancelled')
      .limit(1000),
  ])

  const capacityRows = (capacity.data ?? []) as { capacity_kw: number | string | null }[]

  return {
    total: total.count ?? 0,
    active: active.count ?? 0,
    onHold: onHold.count ?? 0,
    completed: completed.count ?? 0,
    cancelled: cancelled.count ?? 0,
    totalCapacityKw: capacityRows.reduce((sum, row) => sum + Number(row.capacity_kw ?? 0), 0),
  }
}

/**
 * The monitoring board's site list, optionally narrowed to one status.
 *
 * The status filter is a WHERE clause, not a JS `.filter()`. It used to narrow a
 * capped page in memory: past the cap, "Completed" would show a subset of the
 * completed sites while its own count kept counting the same truncated set —
 * wrong twice, and silently.
 */
export async function listRooftopProjects(
  organizationId: string,
  status?: RooftopProjectStatus
): Promise<RooftopProjectWithContext[]> {
  const supabase = await createSupabaseServerClient()

  const query = supabase
    .from('rooftop_projects')
    .select('*, customer:customers(id, name, phone, email, address)')
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .limit(1000)

  const { data } = status ? await query.eq('status', status) : await query

  return (data ?? []) as unknown as RooftopProjectWithContext[]
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
