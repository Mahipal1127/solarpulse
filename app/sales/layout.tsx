import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { SALES_DEPARTMENT_SLUG, isSalesManager } from '@/lib/services/sales'
import { SalesSidebarNav } from '@/components/sales/SalesSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * Sales module shell.
 *
 * These pages live under a real /sales/* path rather than a bare (sales) route
 * group: a route group adds no URL segment, so (sales)/dashboard would resolve
 * to /dashboard and collide with the CEO module's own dashboard, and
 * (sales)/my-tasks would collide with the Tender module's.
 */
export default async function SalesLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDepartment(SALES_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, SALES_DEPARTMENT_SLUG)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`Sales${isSalesManager(user) ? ' · Manager' : ''}`} />
        <SalesSidebarNav isCeo={user.roleName === 'CEO'} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            readOnly
              ? `Viewing the Sales department as ${user.roleName}`
              : `${user.roleName} · Sales department`
          }
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the Sales department&apos;s data as {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
