'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Target,
  Users,
  BarChart3,
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
 * Every Sales surface, in the sidebar.
 *
 * Sales is still a single-master-dashboard module — Dashboard is the one overview and there
 * is no second competing dashboard. What changed is WHERE the other surfaces are listed:
 * here, rather than in a tab strip under the header. A sidebar holding nothing but a lone
 * Dashboard link reads as a half-loaded page.
 *
 * The Dashboard keeps its own My work / Team switch. That toggle re-scopes one surface,
 * which is a different axis from picking a surface, so it stays on the page.
 */
const NAV = [
  { href: '/sales/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/sales/leads', label: 'Leads', icon: Target },
  { href: '/sales/customers', label: 'Customers', icon: Users },
  // The Sales BUSINESS report — pipeline, conversion, targets. 'My Reports' below is the
  // employee's own periodic work report: different route, different table, and the labels
  // are kept deliberately distinct so the two are never mistaken for each other.
  { href: '/sales/reports', label: 'Reports', icon: BarChart3 },
  { href: '/sales/my-tasks', label: 'My Tasks', icon: ListChecks },
  { href: '/sales/my-reports', label: 'My Reports', icon: ScrollText },
]

export function SalesSidebarNav({ isCeo }: { isCeo: boolean }) {
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
