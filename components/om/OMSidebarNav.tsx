'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  HardHat,
  LifeBuoy,
  CalendarClock,
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

const NAV = [
  { href: '/om/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/om/installations', label: 'Installations', icon: HardHat },
  { href: '/om/service', label: 'Service', icon: LifeBuoy },
  { href: '/om/amc', label: 'AMC', icon: CalendarClock },
  { href: '/om/my-tasks', label: 'My Tasks', icon: ListChecks },
  // Beside My Tasks: both are the employee's own work rather than the department's
  // queues. Not the header's "Report" button, which raises an IT support ticket.
  { href: '/om/my-reports', label: 'My Reports', icon: ScrollText },
]

export function OMSidebarNav({ isCeo }: { isCeo: boolean }) {
  const pathname = usePathname()

  return (
    <div className={SIDEBAR_BODY}>
      <nav className="space-y-1">
        {NAV.map((item) => {
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
