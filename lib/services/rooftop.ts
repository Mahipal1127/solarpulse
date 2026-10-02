import 'server-only'

import { createSupabaseServerClient } from '@/lib/supabase/server'
import { logAction } from '@/lib/audit/log'
import { ServiceError } from '@/lib/services/tasks'
import { isDepartmentManager } from '@/lib/auth/guards'
import type { SessionUser } from '@/lib/auth/guards'
import type {
  CreateRooftopProjectInput,
  UpdateRooftopProjectInput,
  CreateRooftopUpdateInput,
} from '@/lib/validation/schemas'
import type { RooftopProject, RooftopSiteUpdate } from '@/lib/types'
import { ROOFTOP_TRANSITIONS } from '@/lib/rooftop/constants'

export { ServiceError }

/**
 * The slug seeded for this department in 0026. Every requireDepartment()
 * guard and every RLS helper keys off it.
 */
export const ROOFTOP_DEPARTMENT_SLUG = 'rooftop'

/**
 * The department-wide tier, matching auth_is_rooftop_lead() in migration 0026.
 * The seeded, working role is 'Rooftop Manager' (the convention
 * auth_is_department_manager() and isDepartmentManager() key off); 'Rooftop
 * Lead' is honoured so a manually-created role still works inside the module,
 * exactly as O&M/Technical/DISCOM do for their lead spellings.
 */
export const ROOFTOP_MANAGER_ROLE_NAMES = ['Rooftop Manager', 'Rooftop Lead']

export function isRooftopLead(user: SessionUser): boolean {
  return (
    user.departmentSlug === ROOFTOP_DEPARTMENT_SLUG &&
    (isDepartmentManager(user) || ROOFTOP_MANAGER_ROLE_NAMES.includes(user.roleName))
  )
}

/**
 * Rooftop records are written by the department only; the CEO reads this
 * module but does not write to it, the same rule Tender/Sales/Technical/O&M
 * enforce.
 */
function assertCanWrite(user: SessionUser): void {
  if (user.departmentSlug !== ROOFTOP_DEPARTMENT_SLUG) {
    throw new ServiceError('Rooftop records are read-only outside the department', 403)
  }
}

/**
 * Status transitions. Deliberately conservative — see lib/rooftop/constants.ts,
 * the single source of truth this module and the status picker share.
 */


/**
 * Loads a record the caller can see, letting RLS decide. A row outside the
 * caller's reach is simply not returned, surfacing as the same 404 as a row
 * that does not exist — not leaking the difference is intentional.
 */
async function loadVisibleProject(
  supabase: Awaited<ReturnType<typeof createSupabaseServerClient>>,
  id: string
): Promise<RooftopProject> {
  const { data } = await supabase
    .from('rooftop_projects')
    .select('*, customer:customers(id, name, phone, email, address)')
    .eq('id', id)
    .maybeSingle()
  if (!data) throw new ServiceError('Rooftop project not found', 404)
  return data as RooftopProject
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/** Every rooftop project the caller may see, newest first. */
export async function listRooftopProjects(user: SessionUser): Promise<RooftopProject[]> {
  const supabase = await createSupabaseServerClient()

  const { data } = await supabase
    .from('rooftop_projects')
    .select('*, customer:customers(id, name, phone, email, address)')
    .eq('organization_id', user.organization_id)
    .order('created_at', { ascending: false })
    .limit(1000)

  return (data ?? []) as unknown as RooftopProject[]
}

/** One project with its customer and its site-update log, newest updates first. */
export async function getRooftopProject(
  user: SessionUser,
  projectId: string
): Promise<{ project: RooftopProject; updates: RooftopSiteUpdate[] }> {
  const supabase = await createSupabaseServerClient()

  // Both reads are keyed on ids the caller already has, so they run together
  // rather than in series — one round trip instead of two on the module's most
  // opened page. A missing project throws from loadVisibleProject; the update
  // read that ran alongside it simply returns nothing.
  const [project, updateResult] = await Promise.all([
    loadVisibleProject(supabase, projectId),
    supabase
      .from('rooftop_site_updates')
      .select('*, author:users!rooftop_site_updates_updated_by_fkey(full_name)')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .limit(200),
  ])

  return {
    project,
    updates: (updateResult.data ?? []) as unknown as RooftopSiteUpdate[],
  }
}

// ---------------------------------------------------------------------------
// Writes — department only
// ---------------------------------------------------------------------------

export async function createRooftopProject(
  user: SessionUser,
  input: CreateRooftopProjectInput
): Promise<RooftopProject> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // The customer must exist and be visible to this department (the
  // rooftop_read_customers policy in 0026 is what makes this read return
  // anything). RLS-hiding it here turns into a clear 400 rather than an
  // opaque FK violation.
  const { data: customer } = await supabase
    .from('customers')
    .select('id')
    .eq('id', input.customer_id)
    .maybeSingle()
  if (!customer) throw new ServiceError('Customer not found in this organization', 400)

  const { data, error } = await supabase
    .from('rooftop_projects')
    .insert({
      organization_id: user.organization_id,
      customer_id: input.customer_id,
      site_address: input.site_address,
      site_city: input.site_city ?? null,
      site_state: input.site_state ?? null,
      site_pincode: input.site_pincode ?? null,
      capacity_kw: input.capacity_kw ?? null,
      go_live_date: input.go_live_date ?? null,
      notes: input.notes ?? null,
      created_by: user.id,
    })
    .select('*, customer:customers(id, name, phone, email, address)')
    .single()

  if (error) throw new ServiceError('Could not create the rooftop project', 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'rooftop_project.created',
    entityType: 'rooftop_project',
    entityId: (data as RooftopProject).id,
  })

  return data as RooftopProject
}

export async function updateRooftopProject(
  user: SessionUser,
  projectId: string,
  input: UpdateRooftopProjectInput
): Promise<RooftopProject> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  const current = await loadVisibleProject(supabase, projectId)

  if (input.status && input.status !== current.status) {
    const allowed = ROOFTOP_TRANSITIONS[current.status] ?? []
    if (!allowed.includes(input.status)) {
      throw new ServiceError(
        `A ${current.status.replace('_', ' ')} site cannot move straight to ${input.status.replace('_', ' ')}`,
        400
      )
    }
  }

  const { data, error } = await supabase
    .from('rooftop_projects')
    .update({
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.site_address !== undefined ? { site_address: input.site_address } : {}),
      ...(input.site_city !== undefined ? { site_city: input.site_city } : {}),
      ...(input.site_state !== undefined ? { site_state: input.site_state } : {}),
      ...(input.site_pincode !== undefined ? { site_pincode: input.site_pincode } : {}),
      ...(input.capacity_kw !== undefined ? { capacity_kw: input.capacity_kw } : {}),
      ...(input.go_live_date !== undefined ? { go_live_date: input.go_live_date } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
    })
    .eq('id', projectId)
    .select('*, customer:customers(id, name, phone, email, address)')
    .single()

  if (error) throw new ServiceError('Could not update the rooftop project', 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'rooftop_project.updated',
    entityType: 'rooftop_project',
    entityId: projectId,
    metadata: input.status ? { status: input.status } : {},
  })

  return data as RooftopProject
}

/**
 * Appends an entry to a site's work log. Any department member may log
 * against any site they can see — monitoring is collective.
 */
export async function addRooftopUpdate(
  user: SessionUser,
  projectId: string,
  input: CreateRooftopUpdateInput
): Promise<RooftopSiteUpdate> {
  assertCanWrite(user)
  const supabase = await createSupabaseServerClient()

  // Confirms the project exists and is visible before writing.
  await loadVisibleProject(supabase, projectId)

  const { data, error } = await supabase
    .from('rooftop_site_updates')
    .insert({
      project_id: projectId,
      updated_by: user.id,
      kind: input.kind,
      note: input.note,
    })
    .select('*, author:users!rooftop_site_updates_updated_by_fkey(full_name)')
    .single()

  if (error) throw new ServiceError('Could not log the site update', 400)

  await logAction({
    organizationId: user.organization_id,
    userId: user.id,
    action: 'rooftop_site_update.created',
    entityType: 'rooftop_site_update',
    entityId: (data as RooftopSiteUpdate).id,
    metadata: { project_id: projectId, kind: input.kind },
  })

  return data as RooftopSiteUpdate
}

