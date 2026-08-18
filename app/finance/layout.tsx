import { requireAnyDepartment } from '@/lib/auth/guards'
import {
  FINANCE_DEPARTMENT_SLUGS,
  isFinanceMember,
  isFinanceLead,
} from '@/lib/services/finance'
import { FinanceSidebarNav } from '@/components/finance/FinanceSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * Finance & Accounts module shell.
 *
 * Under a literal /finance/* path rather than a bare (finance) route group: a route group
 * adds no URL segment, so (finance)/dashboard would resolve to /dashboard and collide with
 * the CEO module's. Same reason every other module carries a literal prefix.
 *
 * The guard is requireAnyDepartment(['finance','accounts']) — NOT requireDepartment('finance')
 * — because 0002 seeds Accounts as a child department of Finance and this module IS the
 * Accounts scope (invoices, bills, ledger, receipts). An Accounts user carries
 * departmentSlug='accounts' and would be wrongly redirected by a finance-only guard. The CEO
 * bypasses the guard (read-only). Read-only is computed from Finance membership rather than
 * isReadOnlyFor(slug), which only compares one slug and would mis-flag an Accounts user.
 */
export default async function FinanceLayout({ children }: { children: React.ReactNode }) {
  const user = await requireAnyDepartment([...FINANCE_DEPARTMENT_SLUGS])
  const member = isFinanceMember(user)
  const readOnly = !member // the CEO (or any bypassing role) views Finance read-only
  const lead = isFinanceLead(user)

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`Finance${lead ? ' · Lead' : ''}`} />
        <FinanceSidebarNav isCeo={user.roleName === 'CEO'} isLead={lead} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={readOnly ? `Viewing Finance as ${user.roleName}` : `${user.roleName} · Finance`}
        />

        {readOnly && (
          <div className="notice-warning border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              Read-only view — you are seeing the Finance department&apos;s data as {user.roleName}.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  )
}
