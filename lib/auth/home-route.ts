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
 * Every module lands on its dashboard rather than its task list: a Sales employee's
 * day starts with their own pipeline and today's follow-ups, a Distribution
 * employee's with what is awaiting approval, on the road, or late, a Technical
 * engineer's with the site visits Sales is waiting on, and a Tender employee's with
 * the submission deadline closing soonest. CEO-assigned tasks are one section of that
 * view, reachable from the sidebar.
 *
 * Tender used to land on /my-tasks because it had no dashboard to land on. It has one
 * now, and a missed submission deadline cannot be recovered — the tender simply
 * closes — so that is what should be on screen first, not a personal task list.
 *
 * Finance now has its own module, so it lands on /finance/dashboard. Its Accounts child
 * department (0002 seeds 'accounts' under 'finance') is the same module — the blueprint's
 * Accounts scope (invoices, bills, ledger, receipts) is Finance — so accounts resolves
 * there too. Approving a Distribution purchase order remains one action within that module,
 * not where their day starts.
 *
 * The same reasoning keeps every other department off /technical/it-support even
 * though raising a ticket there is open to the whole organization. Somebody's day
 * does not start with reporting a broken laptop, and landing them in Technical would
 * suggest it is their module when the one page they can use is a form.
 */
const DEPARTMENT_HOME: Record<string, string> = {
  /*
   * Not '/dashboard'. A route group is a naming device, not a URL segment, so
   * (tender)/dashboard would resolve to the same /dashboard the CEO owns and the two
   * would collide at build time. Hence /overview.
   */
  tender: '/overview',
  sales: '/sales/dashboard',
  distribution: '/distribution/dashboard',
  technical: '/technical/dashboard',
  // Hyphen, matching the slug seeded in 0002. The module lives under a literal
  // /om/* path rather than an (om) route group, for the same /dashboard-collision
  // reason the comment above gives.
  'operations-maintenance': '/om/dashboard',
  // Literal /discom/* path, not a (discom) route group — same /dashboard-collision
  // reason. Slug is lowercase 'discom', seeded in 0002.
  discom: '/discom/dashboard',
  // Literal /marketing/* path, not a (marketing) route group — same collision
  // reason. Slug is 'marketing-training' (hyphen), seeded in 0002; the build spec's
  // 'marketing_training' underscore is wrong.
  'marketing-training': '/marketing/dashboard',
  // Literal /hr/* path, not an (hr) route group — same /dashboard-collision reason.
  // Slug is 'hr', seeded in 0002.
  hr: '/hr/dashboard',
  // Literal /finance/* path, not a (finance) route group — same /dashboard-collision
  // reason. Slug is 'finance', seeded in 0002; its 'accounts' child (also 0002) is the
  // same module and lands here too.
  finance: '/finance/dashboard',
  accounts: '/finance/dashboard',
  // Literal /store/* path, not a (store) route group — same /dashboard-collision
  // reason. Slug is 'store', seeded in 0002. Lands on the dashboard (low-stock
  // alerts + the person's own movements/tasks), not the movement log.
  store: '/store/dashboard',
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

