'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  UserPlus,
  Users,
  CalendarCheck,
  CalendarClock,
  Wallet,
  Target,
  ListChecks,
  ScrollText,
  ArrowLeft,
} from 'lucide-react'
import {
  SIDEBAR_BODY,
  SIDEBAR_FOOTER_GROUP,
  navIconClass,
  navItemClass,
} from '@/components/shared/chrome'

/**
 * HR sidebar. Payroll and Performance are shown to everyone who reaches the module, but
 * the pages behind them gate on the sensitive tier (HR lead / CEO) and a plain HR
 * Executive sees an access notice rather than data — the nav is a map, not the
 * permission boundary. `isLead` only decides whether the payroll/performance links are
 * even worth surfacing to reduce dead-ends for regular staff.
 */
const NAV_BASE = [
  { href: '/hr/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/hr/recruitment', label: 'Recruitment', icon: UserPlus },
  { href: '/hr/employees', label: 'Employees', icon: Users },
  { href: '/hr/attendance', label: 'Attendance', icon: CalendarCheck },
  { href: '/hr/leave', label: 'Leave', icon: CalendarClock },
]

const NAV_SENSITIVE = [
  { href: '/hr/payroll', label: 'Payroll', icon: Wallet },
  { href: '/hr/performance', label: 'Performance', icon: Target },
]

/**
 * Always last, and always shown — every HR employee files their own periodic report,
 * the lead included. Beside My Tasks because both are the person's own work rather
 * than the department's queues.
 */
const NAV_TAIL = [
  { href: '/hr/my-tasks', label: 'My Tasks', icon: ListChecks },
  { href: '/hr/my-reports', label: 'My Reports', icon: ScrollText },
]

export function HrSidebarNav({ isCeo, isLead }: { isCeo: boolean; isLead: boolean }) {
  const pathname = usePathname()
  const items = [...NAV_BASE, ...(isLead ? NAV_SENSITIVE : []), ...NAV_TAIL]

  return (
    <div className={SIDEBAR_BODY}>
      <nav className="space-y-1">
        {items.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link key={item.href} href={item.href} className={navItemClass(active)}>
              <Icon className={navIconClass(active)} />
              <span>{item.label}</span>
            </Link>
          )
        })}
      </nav>

      {isCeo && (
        <div className={SIDEBAR_FOOTER_GROUP}>
          <Link href="/departments" className={navItemClass(false)}>
            <ArrowLeft className={navIconClass(false)} />
            <span>Back to CEO</span>
          </Link>
        </div>
      )}
    </div>
  )
}
