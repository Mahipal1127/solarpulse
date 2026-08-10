import { requireAnyDepartment, isReadOnlyFor, isDepartmentManager } from '@/lib/auth/guards'
import {
  DISTRIBUTION_DEPARTMENT_SLUG,
  PO_APPROVER_DEPARTMENT_SLUGS,
} from '@/lib/services/distribution'
import { DistributionSidebarNav } from '@/components/distribution/DistributionSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * Distribution module shell.
 *
 * Under a real /distribution/* path rather than a bare (distribution) route
 * group: a route group adds no URL segment, so (distribution)/dashboard would
 * resolve to /dashboard and collide with the CEO module's own dashboard — a hard
 * build error, and the same reason the Sales module carries a literal prefix.
 *
 * The shell admits Finance as well as Distribution, which the build spec's file
 * structure does not mention but the approval gate requires: Finance is the only
 * department that may move a PO to 'approved', and without a page to do it from,
 * that endpoint has no caller. Finance is bounded on the way in and on the way
 * down:
 *   * the sidebar offers them purchase orders and nothing else;
 *   * every page except purchase-orders re-guards to Distribution, so a Finance
 *     user typing /distribution/vendors is redirected rather than shown an empty
 *     table;
 *   * RLS grants Finance select on purchase_orders and purchase_order_items only,
 *     so even if both of those were wrong, there is nothing else for them to read.
 */
export default async function DistributionLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAnyDepartment([
    DISTRIBUTION_DEPARTMENT_SLUG,
    ...PO_APPROVER_DEPARTMENT_SLUGS,
  ])
  const readOnly = isReadOnlyFor(user, DISTRIBUTION_DEPARTMENT_SLUG)
  const manager = isDepartmentManager(user)
  const isDistribution = user.departmentSlug === DISTRIBUTION_DEPARTMENT_SLUG

  /**
   * A Finance visitor is not read-only in the way the CEO is: they cannot touch
   * vendors, dispatches, allocations or returns, but approving a purchase order is
   * a write, and it is the one write only they can make. Worth distinguishing —
   * telling them the module is read-only would contradict the button they came to
   * press.
   */
  const isApprover = !isDistribution && user.roleName !== 'CEO'

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand
          subtitle={`Distribution${manager && isDistribution ? ' · Manager' : ''}`}
        />
        <DistributionSidebarNav isCeo={user.roleName === 'CEO'} approverOnly={isApprover} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            isApprover
              ? `Approving purchase orders as ${user.departmentName ?? user.roleName}`
              : readOnly
                ? `Viewing the Distribution department as ${user.roleName}`
                : `${user.roleName} · Distribution department`
          }
        />

        {isApprover ? (
          <div className="notice-info border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              You are here to approve purchase orders. Everything else in Distribution — vendors,
              dispatches, allocations and returns — is theirs to run, not yours to see.
            </p>
          </div>
        ) : (
          readOnly && (
            <div className="notice-warning border-b px-6 py-2.5">
              <p className="text-xs font-medium">
                Read-only view — you are seeing the Distribution department&apos;s data as{' '}
                {user.roleName}.
              </p>
            </div>
          )
        )}
        {children}
      </main>
    </div>
  )
}
