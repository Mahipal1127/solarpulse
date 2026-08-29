import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { STORE_DEPARTMENT_SLUG, isStoreLead } from '@/lib/store/constants'
import { StoreSidebarNav } from '@/components/store/StoreSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * Store module shell.
 *
 * Under a literal /store/* path rather than a bare (store) route group: a route group adds no
 * URL segment, so (store)/dashboard would resolve to /dashboard and collide with the CEO
 * module's. Same reason every other module carries a literal prefix.
 *
 * The guard is requireDepartment(STORE_DEPARTMENT_SLUG): a normal single-department module
 * (like O&M), its own staff plus the CEO read-only. Store has no org-wide exception the way
 * Technical's IT Support does, so everyone else is redirected at the shell. RLS still decides
 * which rows come back.
 *
 * The module's navigation lives in StoreSidebarNav — all ten surfaces, listed there and
 * nowhere else. Being in this layout, it renders once per module and is preserved across
 * navigation between the module's own pages.
 */
export default async function StoreLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDepartment(STORE_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, STORE_DEPARTMENT_SLUG)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`Store${isStoreLead(user) ? ' · Lead' : ''}`} />
        <StoreSidebarNav isCeo={user.roleName === 'CEO'} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={readOnly ? `Viewing Store as ${user.roleName}` : `${user.roleName} · Store`}
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the Store department&apos;s data as {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
