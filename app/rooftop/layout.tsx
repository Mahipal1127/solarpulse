import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { ROOFTOP_DEPARTMENT_SLUG, isRooftopLead } from '@/lib/services/rooftop'
import { RooftopSidebarNav } from '@/components/rooftop/RooftopSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { ResponsiveSidebar } from '@/components/shared/ResponsiveSidebar'

/**
 * Rooftop module shell.
 *
 * Under a literal /rooftop/* path rather than a bare (rooftop) route group: a
 * route group adds no URL segment, so (rooftop)/dashboard would resolve to
 * /dashboard and collide with the CEO module's own dashboard, and
 * (rooftop)/my-tasks would collide with the Tender module's. The same reason
 * Sales, O&M and every module after them carry literal prefixes.
 *
 * The guard is requireDepartment(ROOFTOP_DEPARTMENT_SLUG), not requireUser().
 * Rooftop has no org-wide exception — it is a normal department: its own
 * staff, plus the CEO read-only. Everyone else is redirected at the shell.
 */
export default async function RooftopLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDepartment(ROOFTOP_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, ROOFTOP_DEPARTMENT_SLUG)

  return (
    <ResponsiveSidebar
      sidebar={
        <>
          <SidebarBrand subtitle={`Rooftop${isRooftopLead(user) ? ' · Manager' : ''}`} />
          <RooftopSidebarNav isCeo={user.roleName === 'CEO'} />
        </>
      }
    >
      <main className="flex min-w-0 flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            readOnly
              ? `Viewing Rooftop as ${user.roleName}`
              : `${user.roleName} · Rooftop`
          }
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the Rooftop department&apos;s data as{' '}
              {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </ResponsiveSidebar>
  )
}
