import { requireUser, isReadOnlyFor } from '@/lib/auth/guards'
import {
  TECHNICAL_DEPARTMENT_SLUG,
  isTechnicalLead,
} from '@/lib/services/technical'
import { TechnicalSidebarNav } from '@/components/technical/TechnicalSidebarNav'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { SidebarBrand } from '@/components/shared/SidebarBrand'
import { SIDEBAR_SHELL } from '@/components/shared/chrome'

/**
 * Technical module shell.
 *
 * Under a literal /technical/* path rather than a (technical) route group: a route
 * group adds no URL segment, so (technical)/dashboard would resolve to /dashboard
 * and collide with the CEO module's own dashboard — the same reason Sales and
 * Distribution carry literal prefixes.
 *
 * The guard here is requireUser(), not requireDepartment('technical'), and that is
 * the load-bearing decision in this file. IT support is open to the whole
 * organization by design: anyone may raise a ticket about the company's own tools
 * and follow the ones they raised. Gating the shell on department would redirect the
 * Sales employee who came to check on their broken login, making the module's
 * headline exception unreachable through the UI while RLS happily permitted it.
 *
 * Filing a ticket no longer requires coming here at all — the Report button in every
 * module header posts to the same endpoint from wherever the problem was found. This
 * shell is where a reporter follows what happened next.
 *
 * A visitor is bounded on the way in and on the way down, the same three ways
 * Distribution bounds its Finance approvers:
 *   * the sidebar offers them IT Support and nothing else;
 *   * every other page re-guards to Technical, so a visitor typing
 *     /technical/surveys is redirected rather than shown an empty table;
 *   * RLS returns them only the tickets they raised themselves, so even if both of
 *     those were wrong there is nothing else for them to read.
 */
export default async function TechnicalLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const readOnly = isReadOnlyFor(user, TECHNICAL_DEPARTMENT_SLUG)
  const isTechnical = user.departmentSlug === TECHNICAL_DEPARTMENT_SLUG
  const lead = isTechnicalLead(user)

  /**
   * Someone from another department, here for the org-wide exception. Not read-only
   * in the way the CEO is — filing a ticket is a write, and it is the one write only
   * they can make on their own behalf. Worth distinguishing: telling them the module
   * is read-only would contradict the Report button in the header above.
   */
  const isVisitor = !isTechnical && user.roleName !== 'CEO'

  return (
    <div className="flex h-full">
      <aside className={SIDEBAR_SHELL}>
        <SidebarBrand subtitle={`Technical${lead && isTechnical ? ' · Lead' : ''}`} />
        <TechnicalSidebarNav isCeo={user.roleName === 'CEO'} visitorOnly={isVisitor} />
      </aside>

      <main className="flex flex-1 flex-col overflow-y-auto bg-surface-bg">
        <ModuleHeader
          fullName={user.full_name}
          email={user.email}
          roleName={user.roleName}
          departmentName={user.departmentName}
          subtitle={
            isVisitor
              ? `Following your IT tickets as ${user.departmentName ?? user.roleName}`
              : readOnly
                ? `Viewing the Technical department as ${user.roleName}`
                : `${user.roleName} · Technical department`
          }
        />

        {isVisitor ? (
          <div className="notice-info border-b px-6 py-2.5">
            <p className="text-xs font-medium">
              This is where you follow the IT problems you reported. Use the Report button in any
              header to raise a new one. Surveys, designs and the support queue itself are
              Technical&apos;s to run — you will see the tickets you raised, and nothing else.
            </p>
          </div>
        ) : (
          readOnly && (
            <div className="notice-warning border-b px-6 py-2.5">
              <p className="text-xs font-medium">
                Read-only view — you are seeing the Technical department&apos;s data as{' '}
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
