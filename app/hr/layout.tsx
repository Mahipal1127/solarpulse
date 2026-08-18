import { requireDepartment, isReadOnlyFor } from '@/lib/auth/guards'
import { HR_DEPARTMENT_SLUG, isHrLead } from '@/lib/services/hr'
import { HrSidebarNav } from '@/components/hr/HrSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * HR module shell.
 *
 * Under a literal /hr/* path rather than a bare (hr) route group: a route group adds no
 * URL segment, so (hr)/dashboard would resolve to /dashboard and collide with the CEO
 * module's own. The same reason Sales, Technical, O&M, DISCOM and Marketing carry
 * literal prefixes.
 *
 * The guard is requireDepartment(HR_DEPARTMENT_SLUG): HR is a normal department — its
 * own staff, plus the CEO read-only. Everyone else is redirected at the shell.
 *
 * NOTE on the company-wide personal surfaces (my-attendance, my-leave, my-payslips):
 * those deliberately live OUTSIDE this /hr shell (under /me/*), because every employee
 * in the org needs them, not just HR staff. Guarding them here with
 * requireDepartment('hr') would lock out the entire company from their own attendance
 * and payslips — the opposite of the intent.
 */
export default async function HrLayout({ children }: { children: React.ReactNode }) {
  const user = await requireDepartment(HR_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, HR_DEPARTMENT_SLUG)
  const lead = isHrLead(user)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`HR${lead ? ' · Lead' : ''}`} />
        <HrSidebarNav isCeo={user.roleName === 'CEO'} isLead={lead} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={readOnly ? `Viewing HR as ${user.roleName}` : `${user.roleName} · HR`}
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the HR department&apos;s data as {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
