import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { OM_DEPARTMENT_SLUG, isOMLead } from '@/lib/services/operations'
import { OMSidebarNav } from '@/components/om/OMSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * Operations & Maintenance module shell.
 *
 * Under a literal /om/* path rather than a bare (om) route group: a route group adds
 * no URL segment, so (om)/dashboard would resolve to /dashboard and collide with the
 * CEO module's own dashboard, and (om)/my-tasks would collide with the Tender
 * module's. The same reason Sales and Technical carry literal prefixes.
 *
 * The guard is requireDepartment(OM_DEPARTMENT_SLUG), not requireUser(). Unlike
 * Technical — which opens IT Support to the whole org and so must let visitors in —
 * O&M has no org-wide exception. It is a normal department: its own staff, plus the
 * CEO read-only. Everyone else is redirected at the shell.
 */
export default async function OMLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDepartment(OM_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, OM_DEPARTMENT_SLUG)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`O&M${isOMLead(user) ? ' · Lead' : ''}`} />
        <OMSidebarNav isCeo={user.roleName === 'CEO'} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            readOnly
              ? `Viewing Operations & Maintenance as ${user.roleName}`
              : `${user.roleName} · Operations & Maintenance`
          }
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the Operations &amp; Maintenance department&apos;s
              data as {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
