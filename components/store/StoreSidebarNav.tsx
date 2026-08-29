'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  Package,
  ArrowLeftRight,
  Warehouse,
  Sun,
  Handshake,
  ClipboardList,
  Building2,
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
 * Every Store surface, in the sidebar — the longest of the five at ten entries.
 *
 * Store is still a single-master-dashboard module: Dashboard is the one overview and there
 * is no second competing dashboard. What changed is WHERE the other surfaces are listed:
 * here, rather than in a tab strip under the header. Ten items is exactly the case that
 * argues for a sidebar — the strip had to scroll horizontally to hold them, so the last
 * few were off-screen and undiscoverable, while a vertical list shows all ten at once.
 *
 * Store has no lead-only surface, so there is still no isLead branch here.
 */
const NAV = [
  { href: '/store/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/store/inventory', label: 'Inventory', icon: Package },
  { href: '/store/stock-movements', label: 'Stock Movements', icon: ArrowLeftRight },
  { href: '/store/warehouse', label: 'Warehouse', icon: Warehouse },
  { href: '/store/pm-surya-ghar', label: 'PM Surya Ghar', icon: Sun },
  { href: '/store/dealers', label: 'Dealers', icon: Handshake },
  { href: '/store/market-survey', label: 'Market Survey', icon: ClipboardList },
  { href: '/store/facility', label: 'Facility', icon: Building2 },
  // Last, and together: both are this person's own work rather than the department's
  // queues. My Reports is NOT the header's Report button, which raises an IT ticket.
  { href: '/store/my-tasks', label: 'My Tasks', icon: ListChecks },
  { href: '/store/my-reports', label: 'My Reports', icon: ScrollText },
]

export function StoreSidebarNav({ isCeo }: { isCeo: boolean }) {
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
