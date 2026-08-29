'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Gauge,
  BadgePercent,
  FileText,
  ShieldCheck,
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
 * Every DISCOM surface, in the sidebar.
 *
 * DISCOM is still a single-master-dashboard module — Dashboard is the one overview and
 * there is no second competing dashboard. What changed is WHERE the other surfaces are
 * listed: here, rather than in a tab strip under the header. A sidebar holding nothing but
 * a lone Dashboard link reads as a half-loaded page.
 *
 * Still listed exactly once — the header strip is gone rather than duplicated.
 */
const NAV = [
  { href: '/discom/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/discom/net-metering', label: 'Net Metering', icon: Gauge },
  { href: '/discom/subsidy', label: 'Subsidy', icon: BadgePercent },
  { href: '/discom/documents', label: 'Documents', icon: FileText },
  { href: '/discom/verification', label: 'Verification', icon: ShieldCheck },
  // Last, and together: both are this person's own work rather than the department's
  // queues. My Reports is NOT the header's Report button, which raises an IT ticket.
  { href: '/discom/my-tasks', label: 'My Tasks', icon: ListChecks },
  { href: '/discom/my-reports', label: 'My Reports', icon: ScrollText },
]

export function DiscomSidebarNav({ isCeo }: { isCeo: boolean }) {
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
