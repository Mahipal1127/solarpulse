import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { MARKETING_DEPARTMENT_SLUG, isMarketingLead } from '@/lib/services/marketing'
import { MarketingSidebarNav } from '@/components/marketing/MarketingSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * Marketing & Training module shell.
 *
 * Under a literal /marketing/* path rather than a bare (marketing) route group: a
 * route group adds no URL segment, so (marketing)/dashboard would resolve to
 * /dashboard and collide with the CEO module's own dashboard. The same reason Sales,
 * Technical, O&M and DISCOM carry literal prefixes.
 *
 * The guard is requireDepartment(MARKETING_DEPARTMENT_SLUG), not requireUser():
 * Marketing is a normal department — its own staff, plus the CEO read-only. Everyone
 * else is redirected at the shell.
 */
export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDepartment(MARKETING_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, MARKETING_DEPARTMENT_SLUG)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`Marketing${isMarketingLead(user) ? ' · Lead' : ''}`} />
        <MarketingSidebarNav isCeo={user.roleName === 'CEO'} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            readOnly ? `Viewing Marketing as ${user.roleName}` : `${user.roleName} · Marketing`
          }
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the Marketing &amp; Training department&apos;s data as{' '}
              {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
