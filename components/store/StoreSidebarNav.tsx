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
  Wrench,
  ListChecks,
  ArrowLeft,
} from 'lucide-react'
import {
  SIDEBAR_BODY,
  SIDEBAR_FOOTER_GROUP,
  navIconClass,
  navItemClass,
} from '@/components/shared/chrome'

/**
 * Store sidebar. A flat nav — this module has no lead-only sensitive surface the way Finance's
 * Reports page is (its access is department-wide, see 0017), so there is no isLead branch here;
 * every Store member sees the same map. The nav is a map, not the permission boundary — RLS
 * and the service layer are.
 */
const NAV = [
  { href: '/store/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/store/inventory', label: 'Inventory', icon: Package },
  { href: '/store/stock-movements', label: 'Stock Movements', icon: ArrowLeftRight },
  { href: '/store/warehouse', label: 'Warehouse', icon: Warehouse },
  { href: '/store/pm-surya-ghar', label: 'PM Surya Ghar', icon: Sun },
  { href: '/store/dealers', label: 'Dealers', icon: Handshake },
  { href: '/store/market-survey', label: 'Market Survey', icon: ClipboardList },
  { href: '/store/facility', label: 'Facility', icon: Wrench },
  { href: '/store/my-tasks', label: 'My Tasks', icon: ListChecks },
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
