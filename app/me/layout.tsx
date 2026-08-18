import Link from 'next/link'
import { requireUser } from '@/lib/auth/guards'
import { ModuleHeader } from '@/components/shared/ModuleHeader'
import { homeRouteFor } from '@/lib/auth/home-route'

/**
 * Personal self-service shell — attendance, leave, and payslips for the signed-in
 * employee, whatever department they belong to.
 *
 * This is the one surface in the app that is genuinely company-wide: a Sales executive,
 * a Technical engineer and an HR lead all check in, request leave, and read their own
 * payslips here. So the guard is requireUser() (any active member), NOT
 * requireDepartment('hr') — gating on HR would lock the whole company out of their own
 * records, the exact opposite of the intent. RLS still scopes every read to the
 * caller's own rows.
 *
 * Deliberately under /me/* rather than /hr/*: putting these under the HR module would
 * both imply HR ownership and drag the department guard along with them.
 */
export default async function MeLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser()
  const back = homeRouteFor(user)

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-surface-bg">
      <ModuleHeader
        fullName={user.full_name}
        email={user.email}
        roleName={user.roleName}
        departmentName={user.departmentName}
        subtitle="My workspace"
      />

      <div className="border-b border-border-subtle bg-surface-card px-6 py-2.5">
        <nav className="flex flex-wrap gap-4 text-sm">
          <Link href="/me/attendance" className="text-text-muted hover:text-brand-gold">
            Attendance
          </Link>
          <Link href="/me/leave" className="text-text-muted hover:text-brand-gold">
            Leave
          </Link>
          <Link href="/me/payslips" className="text-text-muted hover:text-brand-gold">
            Payslips
          </Link>
          <Link href={back} className="ml-auto text-text-muted hover:text-brand-gold">
            ← Back to my module
          </Link>
        </nav>
      </div>

      {children}
    </div>
  )
}
