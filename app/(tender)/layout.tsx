import { requireDepartment, isReadOnlyFor, isDepartmentManager } from '@/lib/auth/guards'
import { TENDER_DEPARTMENT_SLUG } from '@/lib/services/tenders'
import { TenderSidebarNav } from '@/components/tender/TenderSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

export default async function TenderLayout({ children }: { children: React.ReactNode }) {
  // Tender department members, plus the CEO — who gets in read-only, per the
  // blueprint's Department Monitoring rule.
  const user = await requireDepartment(TENDER_DEPARTMENT_SLUG)
  const readOnly = isReadOnlyFor(user, TENDER_DEPARTMENT_SLUG)
  const manager = isDepartmentManager(user)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`Tender${manager ? ' · Manager' : ''}`} />
        <TenderSidebarNav isCeo={user.roleName === 'CEO'} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            readOnly
              ? `Viewing the Tender department as ${user.roleName}`
              : `${user.roleName} · Tender department`
          }
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the Tender department&apos;s data as {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
