import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { DISCOM_DEPARTMENT_SLUG, isDiscomLead } from '@/lib/services/discom'
import { DiscomSidebarNav } from '@/components/discom/DiscomSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * DISCOM module shell.
 *
 * Under a literal /discom/* path rather than a bare (discom) route group: a route
 * group adds no URL segment, so (discom)/dashboard would resolve to /dashboard and
 * collide with the CEO module's own dashboard. The same reason Sales, Technical and
 * O&M carry literal prefixes.
 *
 * The guard is requireDepartment(DISCOM_DEPARTMENT_SLUG), not requireUser(): DISCOM
 * is a normal department — its own staff, plus the CEO read-only. Everyone else is
 * redirected at the shell.
 */
export default async function DiscomLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDepartment(DISCOM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, DISCOM_DEPARTMENT_SLUG)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`DISCOM${isDiscomLead(user) ? ' · Lead' : ''}`} />
        <DiscomSidebarNav isCeo={user.roleName === 'CEO'} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            readOnly ? `Viewing DISCOM as ${user.roleName}` : `${user.roleName} · DISCOM`
          }
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the DISCOM department&apos;s data as {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
