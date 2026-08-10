import type { SessionUser } from '@/lib/auth/guards'

/**
 * Where a signed-in user belongs after login, and what `/` resolves to.
 *
 * The CEO owns /dashboard; every other user lands in their own department's
 * module. Only Tender, Sales, Distribution and Technical have modules so far — the
 * rest of the blueprint's departments resolve to /forbidden until their module is
 * built, which is honest about the state of the app rather than bouncing them into a
 * CEO route they cannot read.
 *
 * Sales, Distribution and Technical land on their dashboards rather than their task
 * lists: a Sales employee's day starts with their own pipeline and today's
 * follow-ups, a Distribution employee's with what is awaiting approval, on the road,
 * or late, and a Technical engineer's with the site visits Sales is waiting on.
 * CEO-assigned tasks are one section of that view, reachable from the sidebar.
 *
 * Finance is deliberately absent. Their one job inside Distribution is approving a
 * purchase order, and /distribution/purchase-orders is not where their own day
 * starts — sending them there would imply Distribution is their module. They keep
 * resolving to /forbidden until the Finance module exists; the layout still admits
 * them if they navigate in.
 *
 * The same reasoning keeps every other department off /technical/it-support even
 * though raising a ticket there is open to the whole organization. Somebody's day
 * does not start with reporting a broken laptop, and landing them in Technical would
 * suggest it is their module when the one page they can use is a form.
 */
const DEPARTMENT_HOME: Record<string, string> = {
  tender: '/my-tasks',
  sales: '/sales/dashboard',
  distribution: '/distribution/dashboard',
  technical: '/technical/dashboard',
}

export function homeRouteFor(
  user: Pick<SessionUser, 'roleName' | 'departmentSlug'>
): string {
  if (user.roleName?.toUpperCase() === 'CEO') return '/dashboard'
  if (user.departmentSlug && DEPARTMENT_HOME[user.departmentSlug]) {
    return DEPARTMENT_HOME[user.departmentSlug]
  }
  return '/forbidden'
}

