import 'server-only'

import { cache } from 'react'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import type { AppUser } from '@/lib/types'

export interface SessionUser extends AppUser {
  roleName: string
  departmentName: string | null
  departmentSlug: string | null
}

/**
 * Resolves the signed-in user plus their role name, or null if not signed in.
 *
 * MEMOISED PER REQUEST. Every module layout guards, and then every page beneath it guards again, so
 * this ran at least twice on every navigation — and each run costs two sequential network
 * round-trips: auth.getUser() revalidates the token against Supabase Auth, then the users row is
 * fetched with its role and department embeds. cache() collapses the duplicates within a single
 * render pass, which is the documented way to dedupe non-fetch data access (see "Deduplicating
 * requests" in node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md).
 *
 * This is per-request memoisation, NOT a cross-request cache — React discards it when the render
 * ends. That distinction is load-bearing: anything that outlived the request would serve one user's
 * identity to the next, so never swap this for a persistent cache keyed on nothing.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const supabase = await createSupabaseServerClient()

  let authUser = (await supabase.auth.getUser()).data.user

  /*
   * EXPIRED-SESSION RETRY. The proxy refreshes the session on PAGE navigations only —
   * its matcher deliberately excludes /api — and a page with no browser Supabase client
   * (the onboarding wizard is one) runs no client-side autoRefreshToken either. So a user
   * who sits on one form longer than the access token's lifetime submits with an EXPIRED
   * token, and the route handler is the first thing to notice. One explicit refresh and a
   * second getUser() heals that case (and the refresh-token rotation race, since re-presenting
   * the previous refresh token inside Supabase's reuse interval returns the same new session).
   * Gated on an auth cookie being present so a genuinely anonymous caller skips the attempt
   * instead of spamming the log with AuthSessionMissingError.
   */
  if (!authUser) {
    const jar = await cookies()
    const hasAuthCookie = jar.getAll().some((c) => c.name.includes('auth-token') && c.value)
    if (!hasAuthCookie) return null

    const { error: refreshError } = await supabase.auth.refreshSession()
    if (refreshError) {
      console.error('[auth] session refresh failed', refreshError.message)
      return null
    }
    authUser = (await supabase.auth.getUser()).data.user
    if (!authUser) return null
  }

  const { data, error } = await supabase
    .from('users')
    .select(
      'id, organization_id, department_id, role_id, full_name, email, phone, is_active, created_at, roles(name), departments(name, slug)'
    )
    .eq('id', authUser.id)
    .single()

  // A rejected query and an RLS-empty result both arrive as null, which the caller reads as
  // "Not authenticated" — indistinguishable from a stale session and impossible to diagnose
  // without this line. Log the real cause; the 401 the caller sees stays unchanged.
  if (error || !data) {
    if (error) console.error('[auth] users row lookup failed', error.message)
    return null
  }

  const role = data.roles as unknown as { name: string } | null
  const department = data.departments as unknown as { name: string; slug: string } | null

  return {
    id: data.id,
    organization_id: data.organization_id,
    department_id: data.department_id,
    role_id: data.role_id,
    full_name: data.full_name,
    email: data.email,
    phone: data.phone,
    is_active: data.is_active,
    created_at: data.created_at,
    roleName: role?.name ?? '',
    departmentName: department?.name ?? null,
    departmentSlug: department?.slug ?? null,
  }
})

/**
 * Server-side role gate. Call at the top of every server component under (ceo)/.
 * Redirects rather than throwing, so it is unusable in a route handler — use
 * requireRoleOrThrow there.
 *
 * This is a fast-fail UX layer. RLS is the actual enforcement: a user who gets
 * past this check still cannot read or write rows the database denies them.
 */
export async function requireRole(roleName: string): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) redirect('/login')
  if (!user.is_active) redirect('/login?error=inactive')
  if (user.roleName?.toUpperCase() !== roleName.toUpperCase()) redirect('/forbidden')


  return user
}

/**
 * Server-side department gate, the department-module twin of requireRole.
 * The CEO passes every department check — the blueprint gives them read access
 * to every department's module, and RLS grants it org-wide.
 *
 * Same contract as requireRole: a fast-fail UX layer, redirecting rather than
 * throwing. RLS is still what actually decides which rows come back.
 */
export async function requireDepartment(slug: string): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) redirect('/login')
  if (!user.is_active) redirect('/login?error=inactive')
  if (user.roleName !== 'CEO' && user.departmentSlug !== slug) redirect('/forbidden')

  return user
}

/**
 * requireDepartment for a module more than one department legitimately works in.
 *
 * Distribution is the first: Finance has to reach the purchase order queue to
 * approve orders, and the CEO reads everything. Same fast-fail contract as
 * requireDepartment — RLS still decides which rows come back.
 */
export async function requireAnyDepartment(slugs: string[]): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) redirect('/login')
  if (!user.is_active) redirect('/login?error=inactive')
  if (user.roleName !== 'CEO' && !slugs.includes(user.departmentSlug ?? '')) {
    redirect('/forbidden')
  }

  return user
}

/**
 * Any signed-in, active member of the organization — the redirect-flavoured twin
 * of requireUserOrThrow, for a layout or page rather than a route handler.
 *
 * Exists for the Technical module shell. That module cannot gate on department the
 * way the others do: raising an IT support ticket is deliberately open to everyone
 * in the company, so a requireDepartment('technical') call in its layout would
 * redirect the Sales user who came to report a broken login — locking out the one
 * feature the build spec singles out as an exception. The pages beneath re-guard
 * individually, exactly as Distribution's do for its Finance visitors.
 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) redirect('/login')
  if (!user.is_active) redirect('/login?error=inactive')

  return user
}

/** Route-handler variant of requireDepartment. Throws instead of redirecting. */
export async function requireDepartmentOrThrow(slug: string): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) throw new ForbiddenError('Not authenticated', 401)
  if (!user.is_active) throw new ForbiddenError('Account is inactive', 403)
  if (user.roleName !== 'CEO' && user.departmentSlug !== slug) {
    throw new ForbiddenError('Insufficient department access', 403)
  }

  return user
}

/**
 * requireDepartmentOrThrow for an action several departments may perform.
 *
 * Same contract and the same CEO exemption — it exists because Distribution's
 * Finance approval gate is the first endpoint in this system whose caller is not
 * from the module's own department. Passing a list beats bolting a second guard
 * onto each such route, and keeps the check in one place where it can be kept in
 * step with the matching RLS helper.
 */
export async function requireAnyDepartmentOrThrow(slugs: string[]): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) throw new ForbiddenError('Not authenticated', 401)
  if (!user.is_active) throw new ForbiddenError('Account is inactive', 403)
  if (user.roleName !== 'CEO' && !slugs.includes(user.departmentSlug ?? '')) {
    throw new ForbiddenError('Insufficient department access', 403)
  }

  return user
}

/**
 * True when the caller may only read this department's data. The CEO's access
 * to another department's module is read-only per the blueprint — every write
 * path checks this before mutating.
 */
export function isReadOnlyFor(user: SessionUser, slug: string): boolean {
  return user.departmentSlug !== slug
}

export class ForbiddenError extends Error {
  status: number
  constructor(message = 'Forbidden', status = 403) {
    super(message)
    this.name = 'ForbiddenError'
    this.status = status
  }
}

/**
 * Row-level ownership check for the server side, mirroring what RLS already
 * enforces in the database.
 *
 * RLS is still the source of truth — this exists so a denied write fails with a
 * clear 403 instead of an opaque "0 rows updated", and so the reason is visible
 * in the audit trail. If the two ever disagree, the database wins.
 *
 * `getOwnerId` is a thunk rather than a plain value because callers usually
 * have to fetch the parent row to learn the owner, and there is no point paying
 * for that query when the caller holds a role that skips the check anyway.
 */
export async function requireOwnRecordOrRole(
  user: SessionUser,
  getOwnerId: string | null | (() => Promise<string | null>),
  allowedRoles: string[]
): Promise<void> {
  if (allowedRoles.includes(user.roleName)) return

  const ownerId = typeof getOwnerId === 'function' ? await getOwnerId() : getOwnerId
  if (ownerId && ownerId === user.id) return

  throw new ForbiddenError('This record is not assigned to you', 403)
}

/**
 * Department-manager check, mirroring auth_is_department_manager() in migration
 * 0006. Role names follow the '<Department> Manager' convention seeded in 0005,
 * so this covers future department modules without another change here.
 */
export function isDepartmentManager(user: SessionUser): boolean {
  return user.department_id !== null && /\sManager$/.test(user.roleName)
}

/**
 * Any signed-in, active member of the organization. No role or department check.
 *
 * Exists for the one Technical endpoint deliberately open to the whole company:
 * raising an IT support ticket. ERP problems are reported by every department, and
 * the Report button lives in every module header, so a department gate here would
 * make the feature unusable from the place people actually hit the problem.
 *
 * Not a weaker guard so much as a narrower one: it still rejects anonymous and
 * deactivated callers, and RLS decides what the row may contain. Reach for
 * requireDepartmentOrThrow for anything that manages a queue rather than joining
 * one.
 */
export async function requireUserOrThrow(): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) throw new ForbiddenError('Not authenticated', 401)
  if (!user.is_active) throw new ForbiddenError('Account is inactive', 403)

  return user
}

/** Route-handler variant of requireRole. Throws ForbiddenError instead of redirecting. */
export async function requireRoleOrThrow(roleName: string): Promise<SessionUser> {
  const user = await getSessionUser()

  if (!user) throw new ForbiddenError('Not authenticated', 401)
  if (!user.is_active) throw new ForbiddenError('Account is inactive', 403)
  if (user.roleName !== roleName) throw new ForbiddenError('Insufficient role', 403)

  return user
}
